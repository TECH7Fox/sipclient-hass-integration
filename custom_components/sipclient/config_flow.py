import logging

from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, CONF_USERNAME
import voluptuous as vol

from .const import DOMAIN, MY_IP, ENDPOINT_PORT, STUN_SERVERS

_LOGGER = logging.getLogger(__name__)


class SipClientConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """SIP Client config flow."""

    VERSION = 1
    MINOR_VERSION = 1
    CONNECTION_CLASS = config_entries.CONN_CLASS_LOCAL_PUSH

    async def _show_setup_form(self, user_input=None, errors=None, entry=None):
        """Show the setup form to edit configuration."""
        defaults = {
            CONF_HOST: "localhost",
            CONF_PORT: 5060,
            CONF_USERNAME: "",
            CONF_PASSWORD: "",
            MY_IP: "",
            ENDPOINT_PORT: None,
            STUN_SERVERS: "stun:stun.l.google.com:19302",
        }
        if entry:
            for key in defaults.keys():
                defaults[key] = entry.data.get(key, defaults[key])

        return self.async_show_form(
            step_id="user" if not entry else "reconfigure",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_HOST, default=defaults[CONF_HOST]): str,
                    vol.Required(CONF_PORT, default=defaults[CONF_PORT]): int,
                    vol.Required(CONF_USERNAME, default=defaults[CONF_USERNAME]): str,
                    vol.Required(CONF_PASSWORD, default=defaults[CONF_PASSWORD]): str,
                    vol.Required(MY_IP, default=defaults[MY_IP]): str,
                    vol.Optional(ENDPOINT_PORT, default=defaults[ENDPOINT_PORT]): int,
                    vol.Optional(STUN_SERVERS, default=defaults[STUN_SERVERS]): str,
                }
            ),
            errors=errors or {},
        )

    async def async_step_user(self, user_input=None):
        if user_input is not None:
            _LOGGER.debug("User input: %s", user_input)
            await self.async_set_unique_id(user_input[CONF_USERNAME])
            self._abort_if_unique_id_configured()

            return self.async_create_entry(
                title=f"SIP/{user_input[CONF_USERNAME]} Softphone",
                data=user_input,
            )
        
        return await self._show_setup_form(user_input)

    async def async_step_reauth(self, user_input=None):
        """Handle initial step when updating invalid credentials."""
        return await self.async_step_reconfigure(self, user_input)

    async def async_step_reconfigure(self, user_input=None):
        """Handle reconfiguration."""

        _LOGGER.warning("Reconfigure input: %s", user_input)
        entry = self.hass.config_entries.async_get_entry(self.context["entry_id"])
        
        if user_input is not None:
            # Update the existing entry
            self.hass.config_entries.async_update_entry(
                entry, data=user_input
            )
            await self.hass.config_entries.async_reload(entry.entry_id)
            return self.async_abort(reason="reconfigured")
        
        return await self._show_setup_form(user_input, entry=entry)
