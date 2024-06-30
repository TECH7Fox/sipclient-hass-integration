import {
    LitElement,
    html,
    css,
} from "https://unpkg.com/lit-element@2.0.1/lit-element.js?module";
import { sipCore } from "./sip-core.js";


class ContentCardExample extends LitElement {

    static get properties() {
        return {
            hass: {},
            config: {},
        };
    }

    static get styles() {
        return css`
            ha-card {
                /* sample css */
            }

            #audioVisualizer {
                min-height: 20em;
                height: 100%;
                white-space: nowrap;
                align-items: center;
                display: flex;
                justify-content: center;
            }

            #audioVisualizer div {
                display: inline-block;
                width: 3px;
                height: 100px;
                margin: 0 7px;
                background: currentColor;
                transform: scaleY( .5 );
                opacity: .25;
            }

            .wrapper {
                padding: 8px;
                padding-top: 0px;
                padding-bottom: 2px;
            }

            .flex {
                flex: 1;
                margin-top: 6px;
                margin-bottom: 6px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                min-width: 0;
            }

            .info, .info > * {
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .info {
                flex: 1 1 30%;
                cursor: pointer;
                margin-left: 16px;
                margin-right: 8px;
            }

            .editField {
                width: 100%;
                margin-left: 16px;
                margin-right: 8px;
            }

            state-badge {
                flex-shrink: 0;
            }
        `;
    }

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('sipcore-update', () => this.requestUpdate());
    }
    
    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('sipcore-update', () => this.requestUpdate());
    }

    render() {
        const connection_state = sipCore.pc ? sipCore.pc.connectionState : "unavailable";
        const ice_gatering_state = sipCore.pc ? sipCore.pc.iceGatheringState : "unavailable";
        const ice_connection_state = sipCore.pc ? sipCore.pc.iceConnectionState : "unavailable";

        return html`
            <ha-card header="${this.config.title || "Contacts"}">
                ${this.config.debug ? html`
                    <div>
                        username: ${sipCore.username}
                        <br>
                        call_id: ${sipCore.call_id}
                        <br>
                        call_state: ${sipCore.call_state}
                        <br>
                        connection_state: ${connection_state}
                        <br>
                        ice_gathering: ${ice_gatering_state}
                        <br>
                        ice_connection: ${ice_connection_state}
                        <br>
                
                        <button
                            id="denyButton"
                            @click="${() => sipCore.denyCall()}"
                        >deny</button>
                        <button
                            id="answerButton"
                            @click="${() => sipCore.answerCall()}"
                        >answer</button>
                        <button
                            id="endButton"
                            @click="${() => sipCore.endCall()}"
                        >end</button>
                        <br>
                    </div>
                ` : ""}

                <div class="wrapper">
                    ${Object.entries(this.config.extensions).map(([number, extension]) => {
                        const isMe = number === sipCore.username;
                        const stateObj = this.hass.states[extension.entity];
                        if (extension.hidden) return;
                        if (isMe && this.config.hide_me) return;
                        if (extension.edit) {
                            return html`
                                <div class="flex">
                                    <state-badge
                                        .stateObj=${stateObj}
                                        .overrideIcon=${extension.override_icon}
                                        .stateColor=${this.config.state_color}
                                    ></state-badge>
                                    <ha-textfield
                                        id="custom_${extension.name}"
                                        .value=${number}
                                        .label=${extension.name}
                                        type="text"
                                        .inputmode="text"
                                        class="editField"
                                    ></ha-textfield>
                                    <mwc-button @click="${() => {
                                        const customNumber = this.shadowRoot.getElementById(`custom_${extension.name}`).value;
                                        sipCore.startCall(customNumber)
                                    }}">CALL</mwc-button>
                                </div>
                            `;
                        } else {
                            return html`
                                <div class="flex">
                                    <state-badge
                                        .stateObj=${stateObj}
                                        .overrideIcon=${extension.override_icon}
                                        .stateColor=${this.config.state_color}
                                    ></state-badge>
                                    <div class="info">${extension.name}</div>
                                    <mwc-button @click="${() => sipCore.startCall(number)}">CALL</mwc-button>
                                </div>
                            `;
                        }
                    })}
                </div>
            </ha-card>
        `;
    }

    // The user supplied configuration. Throw an exception and Home Assistant
    // will render an error card.
    setConfig(config) {
        this.config = config;
    }

    firstUpdated() {
        console.log("firstUpdated");
    }

    // The height of your card. Home Assistant uses this to automatically
    // distribute all cards over the available columns.
    getCardSize() {
        return 3;
    }
}

customElements.define("sip-contacts-card", ContentCardExample);

window.customCards = window.customCards || [];
window.customCards.push({
    type: "sip-contacts-card",
    name: "SIP Contacts Card",
    preview: true,
    description: "Offical SIP Contacts Card to make calls",
});
