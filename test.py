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
from pyVoIP.VoIP import VoIPPhone, InvalidStateError

print("test")
phone = VoIPPhone(
    "192.168.2.1",
    5060,
    "1000",
    "1000"
)
print("test2")
phone.start()
print("test3")
print(phone.getStatus())
phone.call("008")
print("test4")
# script doesnt want to shutdown, so we do it manually
# wait for 20 seconds
phone.stop()