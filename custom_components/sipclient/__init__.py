import asyncio
import audioop
import logging
import aiohttp
import voluptuous as vol

from typing import List

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    CONF_DEVICES,
    CONF_HOST,
    CONF_PASSWORD,
    CONF_PORT,
    CONF_USERNAME,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.components import websocket_api
from homeassistant.components.websocket_api import ActiveConnection
from homeassistant.components.websocket_api.http import URL, HomeAssistantView
from aiohttp import web

from aiortc import RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, MediaStreamTrack, RTCConfiguration, RTCIceServer, RTCRtpCapabilities
from pyVoIP.VoIP import VoIPPhone, InvalidStateError, VoIPCall, PhoneStatus, CallState

import av
import numpy as np

_LOGGER = logging.getLogger(__name__)

DOMAIN = "sipclient"


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
            # TODO: Log? Or trigger something?
            raw_audio = self.call.read_audio(self.samples_per_frame, False)

        raw_audio = audioop.lin2lin(raw_audio, 1, 2)
        raw_audio = audioop.bias(raw_audio, 2, -32768)

        raw_audio_array = np.frombuffer(raw_audio, dtype=np.int16)
        raw_audio_array = raw_audio_array.reshape(1, -1)

        frame = av.AudioFrame.from_ndarray(raw_audio_array, format="s16", layout="mono") # AudioFrame(format="s16", layout="mono", samples=samples)
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

    call = hass.data[DOMAIN]["calls"][call_id]["call"] # TODO: Add check if call exists
    outgoing_stream = OutgoingStreamTrack(call=call, hass=hass)
    pc.addTrack(outgoing_stream)

    for transceiver in pc.getTransceivers():
        # if transceiver.receiver.track.kind == "audio":
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
        if (pc.connectionState == "closed" or pc.connectionState == "failed"):
            _LOGGER.warning("Peer connection ended. Hangup call and remove from calls list")
            call.hangup()
            del hass.data[DOMAIN]["calls"][call_id]
    
    @pc.on("track")
    async def on_track(track):
        _LOGGER.warning(f"Received {track.kind} Track")
        if track.kind == "audio":
            while True:
                # TODO: Add a try catch here for aiortc.mediastreams.MediaStreamError
                # And check if the call is still active?
                frame = await track.recv()
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

    hass.data[DOMAIN]["calls"][call_id]["webrtc"] = pc

    return pc


async def callCallback(hass: HomeAssistant, call: VoIPCall):
    _LOGGER.warning("Incoming call to %s", call.phone.username)

    hass.data[DOMAIN]["calls"][call.call_id] = {
        "call": call,
    }

    pc = await create_pc(hass, call.call_id)

    offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    hass.bus.fire("sipclient_incoming_call_event", {
        "call_id": call.call_id,
        "phone": call.phone.username,
        "sdp": offer.sdp,
        # TODO: from
    })


async def answer_call(hass: HomeAssistant, event):                                  # TODO: Create all the event handlers cleanly, and same for answering or offering a call. Then try to copy the "server" example from aiortc.
    _LOGGER.error("Answering call: ")
    _LOGGER.error(event.data)
    call_id = event.data["call_id"]

    answer = RTCSessionDescription(sdp=event.data["sdp"], type="answer")
    pc: RTCPeerConnection = hass.data[DOMAIN]["calls"][call_id]["webrtc"]

    await pc.setRemoteDescription(answer)

    _LOGGER.warning("Answering call %s", call_id)
    call: VoIPCall = hass.data[DOMAIN]["calls"][call_id].get("call")
    call.answer()


async def new_ice_candidate(hass: HomeAssistant, event):
    _LOGGER.error("New ICE candidate: ")
    _LOGGER.error(event.data["candidate"])
    call_id = event.data["call_id"]

    candidate = event.data["candidate"]

    if (candidate["candidate"] == ""):
        return

    splitted_data = candidate["candidate"].replace("candidate:", "").split(" ")
    _LOGGER.warning("Splitted data: ")
    _LOGGER.warning(splitted_data)
    remote_ice_candidate = RTCIceCandidate(
        foundation=splitted_data[0],
        component=splitted_data[1],
        protocol=splitted_data[2],
        priority=int(splitted_data[3]),
        ip=splitted_data[4],
        port=int(splitted_data[5]),
        type=splitted_data[7],
        sdpMid=candidate["sdpMid"],
        sdpMLineIndex=candidate["sdpMLineIndex"],
    )

    pc: RTCPeerConnection = hass.data[DOMAIN]["calls"][call_id]["webrtc"]

    await pc.addIceCandidate(remote_ice_candidate)

# TODO: Setup config flow and multiple entries. One entry per phone?
    
# TODO: Simplify events flow? Now got incoming_call_event, answer_call_event, end_call_event, start_call_event and start_call_ack_event

async def async_setup(hass: HomeAssistant, config: dict):
    """Set up the SIP Client component."""

    # Setup event handlers
    hass.bus.async_listen("sipclient_answer_call_event", lambda event: hass.async_create_task(answer_call(hass, event)))
    hass.bus.async_listen("sipclient_new_ice_candidate_event", lambda event: hass.async_create_task(new_ice_candidate(hass, event)))

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
            callCallback=lambda call: hass.async_create_task(callCallback(hass, call)),
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
