import logging

from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, CONF_USERNAME
import voluptuous as vol

from .const import DOMAIN, MY_IP

_LOGGER = logging.getLogger(__name__)


class SipClientConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """SIP Client config flow."""

    VERSION = 1
    MINOR_VERSION = 1
    CONNECTION_CLASS = config_entries.CONN_CLASS_LOCAL_PUSH

    async def async_step_user(self, user_input=None):
        if user_input is None:
            return self.async_show_form(
                step_id="user",
                data_schema=vol.Schema(
                    {
                        vol.Required(CONF_HOST): str,  # TODO: Default?
                        vol.Required(CONF_PORT, default=5060): int,
                        vol.Required(CONF_USERNAME): str,
                        vol.Required(CONF_PASSWORD): str,
                        vol.Required(MY_IP): str,
                        vol.Optional("endpoint_port"): int,  # TODO: set in const
                    }
                ),
            )

        _LOGGER.debug("User input: %s", user_input)
        await self.async_set_unique_id(user_input[CONF_USERNAME])

        return self.async_create_entry(
            title=f"SIP/{user_input[CONF_USERNAME]} Softphone",
            data=user_input,
        )
