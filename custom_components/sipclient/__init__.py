import asyncio
import audioop
import logging
import aiohttp
import voluptuous as vol

from typing import List
from enum import StrEnum

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    CONF_DEVICES,
    CONF_HOST,
    CONF_PASSWORD,
    CONF_PORT,
    CONF_USERNAME,
)
from homeassistant.core import HomeAssistant, callback, Event
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.components import websocket_api
from homeassistant.components.websocket_api import ActiveConnection
from homeassistant.components.websocket_api.http import URL, HomeAssistantView
from aiohttp import web

from aiortc import RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, MediaStreamTrack, RTCConfiguration, RTCIceServer, RTCRtpCapabilities
from aiortc.mediastreams import MediaStreamError
from pyVoIP.VoIP import VoIPPhone, InvalidStateError, VoIPCall, PhoneStatus, CallState

import av
import numpy as np

_LOGGER = logging.getLogger(__name__)

DOMAIN = "sipclient"


class EndedReason(StrEnum):
    AUDIO_TRACK_FAILED = "Audio track failed"
    CALL_DENIED = "Call denied"
    CALL_ENDED_BY_REMOTE = "Call ended by remote party"
    CALL_ENDED_BY_USER = "Call ended by user"
    CALL_NOT_ANSWERED = "Call not answered"


class OutgoingStreamTrack(MediaStreamTrack):

    kind = "audio"
    sample_rate = 8000
    samples_per_frame = int(0.020 * sample_rate)

    def __init__(self, call: VoIPCall, hass: HomeAssistant):
        super().__init__()
        self.call = call
        self.pts = 0
        self.hass = hass

    async def recv(self):
        if self.call.state == CallState.ANSWERED:
            # Wait for audio data
            raw_audio = await self.hass.async_add_executor_job(self.call.read_audio, self.samples_per_frame, True)
        else:
            # Return silence
            raw_audio = b"\x80" * self.samples_per_frame
            if self.call.state == CallState.ENDED:
                await call_ended(self.hass, self.call, reason=EndedReason.CALL_ENDED_BY_REMOTE)

        raw_audio = audioop.lin2lin(raw_audio, 1, 2)
        raw_audio = audioop.bias(raw_audio, 2, -32768)

        raw_audio_array = np.frombuffer(raw_audio, dtype=np.int16)
        raw_audio_array = raw_audio_array.reshape(1, -1)

        frame = av.AudioFrame.from_ndarray(raw_audio_array, format="s16", layout="mono")
        frame.sample_rate = self.sample_rate
        frame.pts = self.pts
        self.pts += self.samples_per_frame

        return frame


async def create_pc(hass: HomeAssistant, call_id: str) -> RTCPeerConnection:
    configuration = RTCConfiguration(
        iceServers=[
            RTCIceServer(
                urls=["stun:stun.l.google.com:19302"] # TODO: Make configurable
            )
        ]
    )
    pc = RTCPeerConnection(configuration)

    call: VoIPCall = hass.data[DOMAIN]["calls"][call_id]["call"] # TODO: Add check if call exists
    outgoing_stream = OutgoingStreamTrack(call=call, hass=hass)
    pc.addTrack(outgoing_stream)

    for transceiver in pc.getTransceivers():
        codecs = transceiver.receiver.getCapabilities("audio").codecs
        _LOGGER.warning("All Codecs: " + str(codecs))
        # Only get the PCMU codec
        codecs = [codec for codec in codecs if codec.name == "PCMU"]
        _LOGGER.warning("Sorted Codecs: " + str(codecs))
        transceiver.setCodecPreferences(codecs)

    @pc.on("datachannel")
    def on_datachannel(channel):
        _LOGGER.error("datachannel" + channel)

    @pc.on("connectionstatechange")
    def on_connectionstatechange():
        _LOGGER.error("connectionstatechange " + pc.connectionState)
        if (pc.connectionState == "failed"):
            _LOGGER.warning("Peer connection failed. Hangup call and remove from calls list")
            call.bye()
            del hass.data[DOMAIN]["calls"][call_id]
    
    @pc.on("track")
    async def on_track(track):
        _LOGGER.warning(f"Received {track.kind} Track")
        if track.kind == "audio":
            while True:
                try:
                    frame = await track.recv()
                except MediaStreamError:
                    _LOGGER.warning("Track ended")
                    if call.state == CallState.ANSWERED:
                        call.hangup()
                        await call_ended(hass, call, reason=EndedReason.AUDIO_TRACK_FAILED)
                    break
                if frame:
                    frame_data = frame.to_ndarray().tobytes()
                    frame_data = audioop.bias(frame_data, 2, -32768) # Remove bias
                    frame_data = audioop.lin2lin(frame_data, 2, 1) # Convert to 8-bit
                    call.write_audio(frame_data)
                else:
                    break
                await asyncio.sleep(0)
    
    @pc.on("iceconnectionstatechange")
    async def on_iceconnectionstatechange():
        _LOGGER.error("iceconnectionstatechange " + pc.iceConnectionState)

    @pc.on("icegatheringstatechange")
    async def on_icegatheringstatechange():
        _LOGGER.error(f"changed icegatheringstatechange {pc.iceGatheringState}")

    hass.data[DOMAIN]["calls"][call_id]["webrtc"] = pc
    return pc


async def call_ended(hass: HomeAssistant, call: VoIPCall, reason: EndedReason):
    _LOGGER.warning(f"Call ended: {call.call_id}")
    pc: RTCPeerConnection = hass.data[DOMAIN]["calls"][call.call_id]["webrtc"]

    hass.bus.fire("sipclient_call_ended_event", {
        "call_id": call.call_id,
        "caller": {
            "name": call.request.headers["From"]["caller"],
            "number": call.request.headers["From"]["number"],
        },
        "callee": {
            "name": call.request.headers["To"]["caller"],
            "number": call.request.headers["To"]["number"],
        },
        "reason": reason,
    })

    await pc.close()
    del hass.data[DOMAIN]["calls"][call.call_id]


async def incoming_call(hass: HomeAssistant, call: VoIPCall):
    _LOGGER.warning("Incoming call to %s", call.phone.username)
    _LOGGER.warning("To header: " + str(call.request.headers["To"]))
    _LOGGER.warning("From header: " + str(call.request.headers["From"]))

    hass.data[DOMAIN]["calls"][call.call_id] = {
        "call": call,
    }

    pc = await create_pc(hass, call.call_id)

    offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    hass.bus.fire("sipclient_incoming_call_event", {
        "call_id": call.call_id,
        "caller": {
            "name": call.request.headers["From"]["caller"],
            "number": call.request.headers["From"]["number"],
        },
        "callee": {
            "name": call.request.headers["To"]["caller"],
            "number": call.request.headers["To"]["number"],
        },
        "sdp": pc.localDescription.sdp,
    })

    while call.state == CallState.RINGING:
        await asyncio.sleep(1)

    if call.state == CallState.ENDED:
        _LOGGER.warning("Call ended or denied")
        await call_ended(hass, call, reason=EndedReason.CALL_NOT_ANSWERED)


async def deny_call(hass: HomeAssistant, event: Event):
    _LOGGER.warning(f"Denying call: {event.data}")
    call_id = event.data["call_id"]
    call: VoIPCall = hass.data[DOMAIN]["calls"][call_id]["call"]
    try:
        call.deny()
    except:
        call.state = CallState.ENDED


async def answer_call(hass: HomeAssistant, event: Event):
    _LOGGER.warning(f"Answering call: {event.data}")
    call_id = event.data["call_id"]
    answer = RTCSessionDescription(sdp=event.data["sdp"], type="answer")
    pc: RTCPeerConnection = hass.data[DOMAIN]["calls"][call_id]["webrtc"]
    await pc.setRemoteDescription(answer)
    _LOGGER.warning(f"Answering call {call_id}")
    call: VoIPCall = hass.data[DOMAIN]["calls"][call_id]["call"]
    call.answer()


async def start_call(hass: HomeAssistant, event: Event):
    _LOGGER.warning(f"Starting call: {event.data}")

    phone: VoIPPhone | None = hass.data[DOMAIN]["phones"].get(event.data["caller"]["number"])
    if not phone:
        _LOGGER.error(f"Phone {event.data['caller']['number']} not found")
        return

    call = phone.call(event.data["callee"]["number"])
    hass.data[DOMAIN]["calls"][call.call_id] = {
        "call": call,
    }

    pc: RTCPeerConnection = await create_pc(hass, call.call_id)
    
    offer = RTCSessionDescription(sdp=event.data["sdp"], type="offer")
    await pc.setRemoteDescription(offer)

    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    hass.bus.fire("sipclient_outgoing_call_event", {
        "call_id": call.call_id,
        "caller": event.data["caller"],
        "callee": event.data["callee"],
        "sdp": pc.localDescription.sdp,
    })


async def end_call(hass: HomeAssistant, event: Event):
    _LOGGER.warning(f"Ending call: {event.data}")
    call_id = event.data["call_id"]
    call: VoIPCall = hass.data[DOMAIN]["calls"][call_id]["call"]
    if call.state == CallState.ANSWERED:
        call.hangup()
    else:
        call.bye()
    await call_ended(hass, call, reason=EndedReason.CALL_ENDED_BY_USER)


async def seek_call(hass: HomeAssistant, event: Event):
    _LOGGER.warning(f"Seeking call: {event.data}")
    phone: VoIPPhone | None = hass.data[DOMAIN]["phones"].get(event.data["number"])
    if not phone:
        _LOGGER.error(f"Phone {event.data['number']} not found")
        return
    for call in phone.calls.values():
        if call.state == CallState.RINGING:
            await incoming_call(hass, call)


# TODO: Setup config flow and multiple entries. One entry per phone?

async def async_setup(hass: HomeAssistant, config: dict):
    """Set up the SIP Client component."""

    # Setup event handlers
    hass.bus.async_listen("sipclient_answer_call_event", lambda event: hass.async_create_task(answer_call(hass, event)))
    hass.bus.async_listen("sipclient_start_call_event", lambda event: hass.async_create_task(start_call(hass, event)))
    hass.bus.async_listen("sipclient_deny_call_event", lambda event: hass.async_create_task(deny_call(hass, event)))
    hass.bus.async_listen("sipclient_end_call_event", lambda event: hass.async_create_task(end_call(hass, event)))
    hass.bus.async_listen("sipclient_seek_call_event", lambda event: hass.async_create_task(seek_call(hass, event)))

    phones: dict[str, VoIPPhone] = {}
    
    if not config[DOMAIN][CONF_HOST]:
        _LOGGER.error("No host specified")
        return False
    if not config[DOMAIN][CONF_PORT]:
        _LOGGER.error("No port specified")
        return False
    if not config[DOMAIN]["clients"]:
        _LOGGER.error("No clients specified")
        return False
    for client in config[DOMAIN]["clients"]:
        if not client[CONF_USERNAME]:
            _LOGGER.error("No username specified")
            return False
        if not client[CONF_PASSWORD]:
            _LOGGER.error("No password specified")
            return False
        _LOGGER.error("Adding phone with port: %s", config[DOMAIN][CONF_PORT] + len(phones) + 1) # TODO: Option to manually specify port
        phones[client[CONF_USERNAME]] = VoIPPhone(
            server=config[DOMAIN][CONF_HOST],
            port=config[DOMAIN][CONF_PORT],
            username=client[CONF_USERNAME],
            password=client[CONF_PASSWORD],
            myIP=config[DOMAIN]["my_ip"],
            sipPort=config[DOMAIN][CONF_PORT] + len(phones) + 1,
            callCallback=lambda call: hass.async_create_task(incoming_call(hass, call)),
        )

    hass.data[DOMAIN] = {
        "phones": phones,
        "calls": {},
    }

    for phone in phones.values():
        _LOGGER.warning("Starting SIP Client")
        phone.start()
        while phone.get_status() != PhoneStatus.REGISTERED:
            _LOGGER.warning(f"{phone.username} status: {phone.get_status()}")
            # If status is failed, raise a notreadyyet exception to retry later
            await asyncio.sleep(5)
        _LOGGER.warning("SIP Client started with status: %s", phone.getStatus())

    return True


# TODO: Not yet needed without config flow and entries
# async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry):
#     """Unload a config entry."""
#     phones: dict[str, VoIPPhone] = hass.data[DOMAIN]
#     for phone in phones.values():
#         _LOGGER.warning("Stopping SIP Client")
#         phone.stop()
#         _LOGGER.warning("SIP Client stopped")
#     _LOGGER.warning("All SIP Clients stopped")
#     return True


# async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
#     """Reload a config entry."""
#     await async_unload_entry(hass, entry)
#     return await async_setup(hass, entry)
