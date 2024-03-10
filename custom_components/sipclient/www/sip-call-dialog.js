import {
    LitElement,
    html,
    css,
} from "https://unpkg.com/lit-element@2.0.1/lit-element.js?module";
// TODO: Use customelement decorator
import { sipCore, CALLSTATE } from "./sip-core.js";
import { AudioVisualizer } from "./audio-visualizer.js";

console.log("sip-card-test.js");

class SIPCallDialog extends LitElement {

    constructor() {
        super();
        this.open = false;
    }

    static get properties() {
        return {
            hass: {},
            config: {},
            open: { type: Boolean },
        };
    }

    static get styles() {
        return css`
            ha-card {
                /* sample css */
            }
            
            ha-icon {
                display: flex;
                align-items: center;
                justify-content: center;
            }

            #audioVisualizer {
                min-height: 10em;
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

            ha-dialog[data-domain="camera"] {
                --dialog-content-padding: 0;
            }

            ha-camera-stream {
                height: auto;
                width: 100%;
                display: block;
            }

            @media (max-width: 450px), (max-height: 500px) {
                ha-dialog {
                  --dialog-surface-margin-top: 0px;
                }
            }

            @media (max-width: 450px), (max-height: 500px) {
                ha-dialog {
                  --mdc-dialog-min-width: calc( 100vw - env(safe-area-inset-right) - env(safe-area-inset-left) );
                  --mdc-dialog-max-width: calc( 100vw - env(safe-area-inset-right) - env(safe-area-inset-left) );
                  --mdc-dialog-min-height: 100%;
                  --mdc-dialog-max-height: 100%;
                  --vertical-align-dialog: flex-end;
                  --ha-dialog-border-radius: 0;
                }
            }

            .accept-button {
                color: var(--label-badge-green);
            }

            .deny-button {
                color: var(--label-badge-red);
            }

            .deny-button, .accept-button {
                --mdc-icon-button-size: 64px;
                --mdc-icon-size: 32px;
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

    closeDialog() {
        this.open = false;
    }

    render() {
        this.hass = sipCore.hass;

        console.log("dialog open: ", this.open);
        const connection_state = sipCore.pc ? sipCore.pc.connectionState : "unavailable";
        const ice_gatering_state = sipCore.pc ? sipCore.pc.iceGatheringState : "unavailable";
        const ice_connection_state = sipCore.pc ? sipCore.pc.iceConnectionState : "unavailable";
        if (sipCore.audioStream !== null) {
            if (this.audioVisualizer === undefined) {
                this.audioVisualizer = new AudioVisualizer(this.renderRoot, sipCore.audioStream, 16); // TODO: Move to better place
            }
        }
        return html`
            <ha-dialog ?open=${this.open} @closed=${this.closeDialog} hideActions flexContent .heading=${true} data-domain="camera">
                <ha-dialog-header slot="heading">
                    <ha-icon-button
                        dialogAction="cancel"
                        slot="navigationIcon"
                        label="Close">
                        <ha-icon .icon=${"mdi:close"}></ha-icon>
                    </ha-icon-button>
                    <span slot="title" .title="Call">Call</span>
                </ha-dialog-header>
                <div tabindex="-1" dialogInitialFocus>
                    <div style="width: 100%; text-align: center;">
                        <h2 style="text-center">Doorbell</h2>
                    </div>
                    <ha-camera-stream
                        allow-exoplayer
                        muted
                        .hass=${this.hass}
                        .stateObj=${this.hass.states["camera.doorbell"]}
                    ></ha-camera-stream>
                    <div style="display: flex; justify-content: space-between; padding-left: 46px; padding-right: 46px; padding-top: 24px">
                        <span>${sipCore.call_state}</span>
                        <span>${sipCore.timer}</span>
                    </div>
                    call_id: ${sipCore.call_id}
                    connection_state: ${connection_state}
                    ice_gathering: ${ice_gatering_state}
                    ice_connection: ${ice_connection_state}
                    <br><br>
                    <div id="audioVisualizer"></div>
                    <div style="display: flex; justify-content: space-between; padding: 24px;">
                        ${sipCore.call_state === CALLSTATE.CONNECTED ? html`
                            <ha-icon-button
                                class="deny-button"
                                label="End call"
                                @click="${() => sipCore.endCall()}">
                                <ha-icon .icon=${"mdi:phone-hangup"}></ha-icon>
                            </ha-icon-button>
                        ` : html`
                            <ha-icon-button
                                class="deny-button"
                                label="Deny call"
                                @click="${() => sipCore.denyCall()}">
                                <ha-icon .icon=${"mdi:phone-off"}></ha-icon>
                            </ha-icon-button>
                            <ha-icon-button
                                class="accept-button"
                                label="Answer call"
                                @click="${() => sipCore.answerCall()}">
                                <ha-icon .icon=${"mdi:phone"}></ha-icon>
                            </ha-icon-button>
                        `}
                    </div>
                </div>
            </ha-dialog>
        `;
    }

    firstUpdated() {
        console.log("firstUpdated popup");
    }
}

// @ts-ignore
customElements.define('sip-call-dialog', SIPCallDialog);
