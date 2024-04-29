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
                padding-top: 2em;
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

            ha-dialog {
                --dialog-content-padding: 0;
                --mdc-dialog-min-width: 600px;
            }

            ha-camera-stream {
                height: 100%;
                width: 100%;
                display: block;
            }

            @media (max-width: 450px), (max-height: 500px) {
                ha-dialog {
                  --dialog-surface-margin-top: 0px;
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

            .row {
                display: flex;
                flex-direction: row;
            }

            .top-row {
                display: flex;
                flex-direction: row;
                justify-content: space-between;
                margin-left: 24px;
                margin-right: 24px;
            }

            .bottom-row {
                display: flex;
                justify-content: space-between;
                margin: 24px;
            }
              
            .scrolling_text {
                overflow: hidden;
                display: flex;
                white-space: nowrap;
                width: 80px;
            }

            .text {
                margin-right: 5px;
            }

            .content {
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 300px;
                width: 100%;
                background-color: #2d3033;
            }

            /* TODO: check if needed
            @-moz-keyframes animate_text {
                from { -moz-transform: translate3d(0, 0, 0); }
                to { -moz-transform: translate3d(-100%, 0, 0); }
            }
              
            @-webkit-keyframes animate_text {
                from { -webkit-transform: translate3d(0, 0, 0); }
                to { -webkit-transform: translate3d(-100%, 0, 0); }
            }
            */
            
            @keyframes scrolling_left {
                from {
                    -webkit-transform: translate3d(0, 0, 0);
                    -moz-transform: translate3d(0, 0, 0);
                    transform: translate3d(0, 0, 0);
                }
                to {
                    -webkit-transform: translate3d(-100%, 0, 0);
                    -moz-transform: translate3d(-100%, 0, 0);
                    transform: translate3d(-100%, 0, 0);
                }
            }
            
            @keyframes scrolling_right {
                from {
                    -webkit-transform: translate3d(-100%, 0, 0);
                    -moz-transform: translate3d(-100%, 0, 0);
                    transform: translate3d(-100%, 0, 0);
                }
                to {
                    -webkit-transform: translate3d(0, 0, 0);
                    -moz-transform: translate3d(0, 0, 0);
                    transform: translate3d(0, 0, 0);
                }
            }
        `;
    }

    connectedCallback() {
        super.connectedCallback();
        this.updateHandler = (event) => {
            switch (event.detail.reason) {
                case "outgoing_call":
                case "incoming_call":
                    this.open = true;
                case "call_ended":
                    this.open = false;
                    break;
            }
            this.requestUpdate();
        }
        window.addEventListener('sipcore-update', this.updateHandler);
    }
    
    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('sipcore-update', this.updateHandler);
    }

    closeDialog() {
        this.open = false;
        this.requestUpdate();
    }

    render() {
        this.hass = sipCore.hass;
        this.config = sipCore.config.popup.card_config;

        console.log("dialog open: ", this.open);

        const scroll_direction = sipCore.call_state !== CALLSTATE.INCOMING ? "scrolling_left" : "scrolling_right";
        let state_title;
        switch (sipCore.call_state) {
            case CALLSTATE.IDLE:
                state_title = "IDLE";
                break;
            case CALLSTATE.INCOMING:
                state_title = `INCOMING CALL FROM 008`;
                break;
            case CALLSTATE.CALLING: // TODO: Rename to OUTGOING?
                state_title = `CALLING 008`;
                break;
            // case CALLSTATE.CONNECTED: // TODO: These custom titles needed?
            //     state_title = `CONNECTED TO 008`;
            //     break;
            // case CALLSTATE.CONNECTING:
            //     state_title = `CONNECTING TO CALL`;
            //     break;
            default:
                state_title = sipCore.call_state;
                break;
        }

        let camera = false;

        if (sipCore.call_state !== CALLSTATE.IDLE) {
            console.log(this.config.extensions);
            if (this.config.extensions[sipCore.callee] && this.config.extensions[sipCore.callee].camera) {
                camera = true;
            } else {
                if (sipCore.audioStream !== null) {
                    if (this.audioVisualizer === undefined) {
                        this.audioVisualizer = new AudioVisualizer(this.renderRoot, sipCore.audioStream, 16); // TODO: Move to better place
                    }
                } else {
                    this.audioVisualizer = undefined;
                }
                camera = false;
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
                    <div class="top-row">
                        <h2>${state_title}</h2>
                        ${sipCore.call_state !== CALLSTATE.IDLE ? html`
                            <div class="row">
                                <h2>${sipCore.username} <</h2>
                                <div class="scrolling_text">
                                    <h2
                                        class="text"
                                        style="animation: ${scroll_direction} 20s linear infinite;"
                                    >- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</h2>
                                    <h2
                                        class="text"
                                        style="animation: ${scroll_direction} 20s linear infinite;"
                                    >- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</h2>
                                </div>
                                <h2>> ${sipCore.callee}</h2>
                            </div>
                        ` : ""}
                        <h2>${sipCore.timer}</h2>
                    </div>
                    <div class="content">
                        <div id="audioVisualizer" style="display: ${camera ? "hidden" : "block"}"></div>
                        ${camera ? html`
                            <ha-camera-stream
                                allow-exoplayer
                                muted
                                .hass=${this.hass}
                                .stateObj=${this.hass.states[this.config.extensions[sipCore.callee].camera]}
                            ></ha-camera-stream>
                        ` : ""}
                    </div>
                    <div class="bottom-row">
                        <ha-icon-button
                            class="deny-button"
                            label="End call"
                            @click="${() => {
                                if (sipCore.call_state === CALLSTATE.CONNECTED) {
                                    sipCore.endCall();
                                } else {
                                    sipCore.denyCall();
                                }
                                this.closeDialog();
                            }}">
                            <ha-icon .icon=${"mdi:phone-off"}></ha-icon>
                        </ha-icon-button>
                        <ha-icon-button
                            class="accept-button"
                            label="Answer call"
                            @click="${() => sipCore.answerCall()}">
                            <ha-icon .icon=${"mdi:phone"}></ha-icon>
                        </ha-icon-button>
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
