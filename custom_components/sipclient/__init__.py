import asyncio
import logging

from homeassistant.config_entries import ConfigEntry, ConfigEntryNotReady
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, CONF_USERNAME
from homeassistant.core import HomeAssistant
import pyVoIP
from pyVoIP.VoIP import PhoneStatus, VoIPPhone

from .const import DOMAIN, MY_IP, STUN_SERVERS
from .sip_to_webrtc import incoming_call, setup_event_listeners

pyVoIP.REGISTER_FAILURE_THRESHOLD = 1

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Set up a config entry."""
    port: int = entry.data.get("endpoint_port", 5061)
    username: str = entry.data[CONF_USERNAME]
    phone = VoIPPhone(
        server=entry.data[CONF_HOST],
        port=entry.data[CONF_PORT],
        username=username,
        password=entry.data[CONF_PASSWORD],
        myIP=entry.data[MY_IP],
        sipPort=port,
        callCallback=lambda call: hass.loop.create_task(incoming_call(hass, call)),
    )

    sip_str = f"{username}@{phone.server}:{phone.port}"
    _LOGGER.info(f"Starting SIP Client {sip_str}")

    try:
        phone.start()
    except OSError as e:
        _LOGGER.debug(f"Address {entry.data[MY_IP]}:{port} not available for {sip_str}")
        raise ConfigEntryNotReady(f"Failed to start SIP Client {sip_str}: {e}")

    while phone.get_status() != PhoneStatus.REGISTERED:
        if phone.get_status() == PhoneStatus.FAILED:
            _LOGGER.debug(
                f"SIP Client failed to register {sip_str}. Timeout or invalid authentication"
            )
            raise ConfigEntryNotReady(
                f"Failed to register SIP Client {sip_str}: Timeout or invalid authentication"
            )
        _LOGGER.debug(
            f"Waiting for {sip_str} to register. Status: {phone.get_status()}"
        )
        await asyncio.sleep(5)

    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {
            "phones": {username: phone},
            "calls": {},
            "stun_servers": str(entry.data[STUN_SERVERS]).split(",")
        }
        setup_event_listeners(hass)
    else:
        hass.data[DOMAIN]["phones"][username] = phone

    _LOGGER.info(f"Started SIP Client {sip_str}")
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Unload a config entry."""
    phones: dict[str, VoIPPhone] = hass.data[DOMAIN]["phones"]
    for phone in phones.values():
        _LOGGER.info(f"Stopping SIP Client {phone.username}")
        phone.stop()
        _LOGGER.info(f"SIP Client {phone.username} stopped")
    _LOGGER.info("All SIP Clients stopped")
    return True


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Reload a config entry."""
    await async_unload_entry(hass, entry)
    return await async_setup_entry(hass, entry)
