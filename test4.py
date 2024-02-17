import asyncio
import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    CONF_DEVICES,
    CONF_HOST,
    CONF_PASSWORD,
    CONF_PORT,
    CONF_USERNAME,
)
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.components import websocket_api
from homeassistant.helpers import config_validation as vol
from homeassistant.components.websocket_api import ActiveConnection
from pyVoIP.VoIP import VoIPPhone, InvalidStateError, CallState, VoIPCall
import av
import numpy as np
import time

import wave

import pyVoIP

pyVoIP.TRANSMIT_DELAY_REDUCTION = 0.75


def answer(call: VoIPCall):
    try:

        f = wave.open("avs.wav", "rb")
        frames = f.getnframes()
        data = f.readframes(frames)
        f.close()

        call.answer()

        call.write_audio(data)

        stop = time.time() + (frames / 8000)

        while time.time() <= stop and call.state == CallState.ANSWERED:
            time.sleep(0.1)
        call.hangup()

        # pts = 0
        # while True:
        #     if call.state == CallState.ANSWERED:
        #         # print("Call answered")
        #         raw_audio = call.read_audio(length=80, blocking=False)
        #         raw_audio_array = np.frombuffer(raw_audio, dtype=np.int8)
        #         raw_audio_array = raw_audio_array.astype(np.int16)  # Convert to 16-bit integers
        #         raw_audio_array = np.expand_dims(raw_audio_array, axis=0)  # Add an extra dimension
        #         # print(raw_audio_array.shape[0])
        #         # print(raw_audio_array)
        #         frame = av.AudioFrame.from_ndarray(raw_audio_array, format="s16", layout="mono")
        #         frame.sample_rate = 8000
        #         frame.pts = pts
        #         pts += 1
        #         print("frame " + str(pts))
        #     else:
        #         print("Call not answered")
        #         sleep(0.5)

    except InvalidStateError:
        print("Error")
    except:
        print("Hard error")
        call.hangup()

if __name__ == "__main__":
    phone = VoIPPhone(
        "192.168.2.1",
        5060,
        "1000",
        "1000",
        callCallback=answer,
        myIP="192.168.2.94"
        # sipPort=5062,
    )
    phone.start()
    input("Press enter to disable the phone")
    phone.stop()
