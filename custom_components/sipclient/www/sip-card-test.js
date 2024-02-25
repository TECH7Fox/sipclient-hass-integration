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
            <ha-card header="SIP Core test">
                call_id: ${sipCore.call_id}
                <br>
                connection_state: ${connection_state}
                <br>
                ice_gathering: ${ice_gatering_state}
                <br>
                ice_connection: ${ice_connection_state}
                <br><br>
                <button
                    id="callButton"
                    @click="${() => sipCore.startCall(this.config.to)}"
                >call</button>
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
                <br>
                <audio id="audio" autoplay controls></audio>
            </ha-card>
        `;
    }

    // The user supplied configuration. Throw an exception and Home Assistant
    // will render an error card.
    setConfig(config) {
        if (!config.from) {
            throw new Error("You need to define a from number");
        }
        if (!config.to) {
            throw new Error("You need to define a to number");
        }
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

customElements.define("test-card", ContentCardExample);

window.customCards = window.customCards || [];
window.customCards.push({
    type: "test-card",
    name: "Test Card",
    preview: true,
    description: "Card just for testing!"
});
