import asyncio
import logging

from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, CONF_USERNAME
from homeassistant.core import HomeAssistant
from pyVoIP.VoIP import PhoneStatus, VoIPPhone

from .const import DOMAIN
from .sip_to_webrtc import incoming_call, setup_event_listeners

_LOGGER = logging.getLogger(__name__)

# TODO: Setup config flow and multiple entries. One entry per phone?


async def async_setup(hass: HomeAssistant, config: dict):
    """Set up the SIP Client component."""

    setup_event_listeners(hass)

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
        _LOGGER.error(
            "Adding phone with port: %s", config[DOMAIN][CONF_PORT] + len(phones) + 1
        )  # TODO: Option to manually specify port
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
