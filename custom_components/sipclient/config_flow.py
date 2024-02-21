import logging

from homeassistant import config_entries
import voluptuous as vol

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


class SipClientConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """SIP Client config flow."""

    VERSION = 1
    MINOR_VERSION = 1

    async def async_step_user(self, info):
        if info is not None:
            _LOGGER.warning("User info: %s", info)

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required("host"): str,
                    vol.Required("port"): int,
                    vol.Required("password"): str,
                    vol.Required("username"): str,
                    vol.Optional("endpoint_port", default=None): int,
                }
            ),
        )
