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
import librosa
import soundfile as sf
import pyVoIP
import resampy
from scipy.special import log1p
from scipy.io import wavfile
from scipy.signal import resample
from pydub import AudioSegment
import audioop

pyVoIP.TRANSMIT_DELAY_REDUCTION = 0.75
pyVoIP.DEBUG = False


# y, sr = librosa.load("test_music.wav", sr=8000)
# y_8bit = (y * 32767).astype(np.int16)
# sf.write("test_music_8bit.wav", y_8bit, 8000, 'PCM_16')

def mu_law(x, mu=255):
    x_mu = np.sign(x) * log1p(mu * np.abs(x)) / log1p(mu)
    return ((x_mu + 1) / 2 * mu + 0.5).astype(np.uint8)


def answer(call: VoIPCall):
    try:
        y, sr = sf.read("test_music.wav", dtype='int16')

        if y.ndim > 1:
            y = np.mean(y, axis=1)

        y_8k = librosa.resample(y.astype(float) / 32767, orig_sr=sr, target_sr=8000)

        # Apply the mu-law companding
        y_8k_8bit = mu_law(y_8k)

        call.answer()

        call.write_audio(y_8k_8bit.tobytes())

        stop = time.time() + (len(y_8k_8bit) / 8000)

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
