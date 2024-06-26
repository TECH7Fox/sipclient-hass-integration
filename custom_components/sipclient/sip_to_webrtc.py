import asyncio
import audioop
from enum import StrEnum
import logging

from aiortc import (
    MediaStreamTrack,
    RTCConfiguration,
    RTCIceServer,
    RTCPeerConnection,
    RTCSessionDescription,
)
from aiortc.mediastreams import MediaStreamError
import av
from homeassistant.core import Event, HomeAssistant
import numpy as np
from pyVoIP.VoIP import CallState, VoIPCall, VoIPPhone

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


class EndedReason(StrEnum):
    AUDIO_TRACK_FAILED = "Audio track failed"
    CALL_DENIED = "Call denied"
    CALL_ENDED_BY_REMOTE = "Call ended by remote party"
    CALL_ENDED_BY_USER = "Call ended by user"
    CALL_NOT_ANSWERED = "Call not answered"


class OutgoingStreamTrack(MediaStreamTrack):
    """A PCMU audio stream track that reads from a VoIPCall."""

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
            raw_audio = await self.hass.async_add_executor_job(
                self.call.read_audio, self.samples_per_frame, True
            )
        else:
            # Return silence
            raw_audio = b"\x80" * self.samples_per_frame
            if self.call.state == CallState.ENDED:
                await call_ended(
                    self.hass, self.call, reason=EndedReason.CALL_ENDED_BY_REMOTE
                )

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
    stun_servers = hass.data[DOMAIN]["stun_servers"]
    configuration = RTCConfiguration(
        iceServers=[
            RTCIceServer(
                urls=stun_servers,
            )
        ]
    )
    pc = RTCPeerConnection(configuration)

    call: VoIPCall = hass.data[DOMAIN]["calls"][call_id][
        "call"
    ]  # TODO: Add check if call exists
    outgoing_stream = OutgoingStreamTrack(call=call, hass=hass)
    pc.addTrack(outgoing_stream)

    for transceiver in pc.getTransceivers():
        codecs = transceiver.receiver.getCapabilities("audio").codecs
        _LOGGER.debug("All Codecs: " + str(codecs))
        # Only get the PCMU codec
        codecs = [codec for codec in codecs if codec.name == "PCMU"]
        _LOGGER.debug("Sorted Codecs: " + str(codecs))
        transceiver.setCodecPreferences(codecs)

    @pc.on("datachannel")
    def on_datachannel(channel):
        _LOGGER.debug("datachannel" + channel)

    @pc.on("connectionstatechange")
    def on_connectionstatechange():
        _LOGGER.debug("connectionstatechange " + pc.connectionState)
        if pc.connectionState == "failed":
            _LOGGER.warning(
                "Peer connection failed. Hangup call and remove from calls list"
            )
            call.bye()
            if call_id in hass.data[DOMAIN]["calls"]:
                del hass.data[DOMAIN]["calls"][call_id]

    @pc.on("track")
    async def on_track(track):
        _LOGGER.debug(f"Received {track.kind} Track")
        if track.kind == "audio":
            while True:
                try:
                    frame = await track.recv()
                except MediaStreamError:
                    _LOGGER.debug("Track ended")
                    if call.state == CallState.ANSWERED:
                        call.hangup()
                        await call_ended(
                            hass, call, reason=EndedReason.AUDIO_TRACK_FAILED
                        )
                    break
                if frame:
                    frame_data = frame.to_ndarray().tobytes()
                    frame_data = audioop.bias(frame_data, 2, -32768)  # Remove bias
                    frame_data = audioop.lin2lin(frame_data, 2, 1)  # Convert to 8-bit
                    call.write_audio(frame_data)
                else:
                    break
                await asyncio.sleep(0)

    @pc.on("iceconnectionstatechange")
    async def on_iceconnectionstatechange():
        _LOGGER.debug("iceconnectionstatechange " + pc.iceConnectionState)

    @pc.on("icegatheringstatechange")
    async def on_icegatheringstatechange():
        _LOGGER.debug(f"changed icegatheringstatechange {pc.iceGatheringState}")

    hass.data[DOMAIN]["calls"][call_id]["webrtc"] = pc
    return pc


async def call_ended(hass: HomeAssistant, call: VoIPCall, reason: EndedReason):
    _LOGGER.info(f"Call ended: {call.call_id}")
    pc: RTCPeerConnection = hass.data[DOMAIN]["calls"][call.call_id]["webrtc"]

    hass.bus.fire(
        "sipclient_call_ended_event",
        {
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
        },
    )

    if pc.connectionState != "closed":
        await pc.close()
    else:
        _LOGGER.debug("Peer connection already closed")
    if call.call_id in hass.data[DOMAIN]["calls"]:
        del hass.data[DOMAIN]["calls"][call.call_id]


async def incoming_call(hass: HomeAssistant, call: VoIPCall):
    _LOGGER.info(f"Incoming call to {call.phone.username}")

    hass.data[DOMAIN]["calls"][call.call_id] = {
        "call": call,
    }

    pc = await create_pc(hass, call.call_id)

    offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    hass.bus.fire(
        "sipclient_incoming_call_event",
        {
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
        },
    )

    while call.state == CallState.RINGING:
        await asyncio.sleep(1)

    if call.state == CallState.ENDED:
        _LOGGER.info("Outgoing call timed out or denied")
        await call_ended(hass, call, reason=EndedReason.CALL_NOT_ANSWERED)


async def deny_call(hass: HomeAssistant, event: Event):
    _LOGGER.debug(f"Denying call: {event.data}")
    call_id = event.data["call_id"]
    if call_id not in hass.data[DOMAIN]["calls"]:
        _LOGGER.error(f"Call {call_id} not found")
        return
    call: VoIPCall = hass.data[DOMAIN]["calls"][call_id]["call"]
    try:
        call.deny()
    except Exception:
        call.state = CallState.ENDED


async def answer_call(hass: HomeAssistant, event: Event):
    _LOGGER.debug(f"Answering call: {event.data}")
    call_id = event.data["call_id"]
    answer = RTCSessionDescription(sdp=event.data["sdp"], type="answer")
    pc: RTCPeerConnection = hass.data[DOMAIN]["calls"][call_id]["webrtc"]
    await pc.setRemoteDescription(answer)
    call: VoIPCall = hass.data[DOMAIN]["calls"][call_id]["call"]
    call.answer()


async def start_call(hass: HomeAssistant, event: Event):
    _LOGGER.info(f"Starting call: {event.data}")

    phone: VoIPPhone | None = hass.data[DOMAIN]["phones"].get(event.data["caller"])
    if not phone:
        _LOGGER.error(f"Phone {event.data['caller']} not found")
        return

    call = phone.call(event.data["callee"])
    hass.data[DOMAIN]["calls"][call.call_id] = {
        "call": call,
    }

    pc: RTCPeerConnection = await create_pc(hass, call.call_id)

    offer = RTCSessionDescription(sdp=event.data["sdp"], type="offer")
    await pc.setRemoteDescription(offer)

    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    hass.bus.fire(
        "sipclient_outgoing_call_event",
        {
            "call_id": call.call_id,
            "caller": event.data["caller"],
            "callee": event.data["callee"],
            "sdp": pc.localDescription.sdp,
        },
    )


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
    for call in list(phone.calls.values()):
        if call.state == CallState.RINGING:
            await incoming_call(hass, call)


def setup_event_listeners(hass: HomeAssistant):
    hass.bus.async_listen(
        "sipclient_answer_call_event",
        lambda event: hass.loop.create_task(answer_call(hass, event)),
    )
    hass.bus.async_listen(
        "sipclient_start_call_event",
        lambda event: hass.loop.create_task(start_call(hass, event)),
    )
    hass.bus.async_listen(
        "sipclient_deny_call_event",
        lambda event: hass.loop.create_task(deny_call(hass, event)),
    )
    hass.bus.async_listen(
        "sipclient_end_call_event",
        lambda event: hass.loop.create_task(end_call(hass, event)),
    )
    hass.bus.async_listen(
        "sipclient_seek_call_event",
        lambda event: hass.loop.create_task(seek_call(hass, event)),
    )
