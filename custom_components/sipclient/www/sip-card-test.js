import {
    LitElement,
    html,
    css,
} from "https://unpkg.com/lit-element@2.0.1/lit-element.js?module";
import { sipCore } from "./sip-core.js";
import { AudioVisualizer } from "./audio-visualizer.js";


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
        if (sipCore.audioStream !== null) {
            if (this.audioVisualizer === undefined) {
                this.audioVisualizer = new AudioVisualizer(this.renderRoot, sipCore.audioStream, 16); // TODO: Move to better place
            }
        } else {
            this.audioVisualizer = undefined;
        }
        let number = "";
        let name = "";
        console.log("config at render: ", sipCore.config);
        if (sipCore.config.extensions && sipCore.config.extensions.length > 0) {
            number = sipCore.config.extensions[0].number;
            name = sipCore.config.extensions[0].name;
        };
        return html`
            <ha-card header="SIP Core test">
                call_id: ${sipCore.call_id}
                <br>
                call_state: ${sipCore.call_state}
                <br>
                connection_state: ${connection_state}
                <br>
                ice_gathering: ${ice_gatering_state}
                <br>
                ice_connection: ${ice_connection_state}
                <br><br>
                <button
                    id="callButton"
                    @click="${() => sipCore.startCall(number)}"
                >${name}</button>
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
                <div id="audioVisualizer"></div>
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
