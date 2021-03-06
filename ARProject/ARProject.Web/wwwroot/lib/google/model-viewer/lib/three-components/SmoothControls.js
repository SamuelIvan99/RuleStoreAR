/* @license
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Euler, EventDispatcher, Spherical } from 'three';
import { clamp } from '../utilities.js';
import { Damper, SETTLING_TIME } from './Damper.js';
export const DEFAULT_OPTIONS = Object.freeze({
    minimumRadius: 0,
    maximumRadius: Infinity,
    minimumPolarAngle: Math.PI / 8,
    maximumPolarAngle: Math.PI - Math.PI / 8,
    minimumAzimuthalAngle: -Infinity,
    maximumAzimuthalAngle: Infinity,
    minimumFieldOfView: 10,
    maximumFieldOfView: 45,
    interactionPolicy: 'always-allow',
    touchAction: 'pan-y'
});
// Constants
const TOUCH_EVENT_RE = /^touch(start|end|move)$/;
const KEYBOARD_ORBIT_INCREMENT = Math.PI / 8;
const ZOOM_SENSITIVITY = 0.04;
export const KeyCode = {
    PAGE_UP: 33,
    PAGE_DOWN: 34,
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40
};
export const ChangeSource = {
    USER_INTERACTION: 'user-interaction',
    NONE: 'none'
};
/**
 * SmoothControls is a Three.js helper for adding delightful pointer and
 * keyboard-based input to a staged Three.js scene. Its API is very similar to
 * OrbitControls, but it offers more opinionated (subjectively more delightful)
 * defaults, easy extensibility and subjectively better out-of-the-box keyboard
 * support.
 *
 * One important change compared to OrbitControls is that the `update` method
 * of SmoothControls must be invoked on every frame, otherwise the controls
 * will not have an effect.
 *
 * Another notable difference compared to OrbitControls is that SmoothControls
 * does not currently support panning (but probably will in a future revision).
 *
 * Like OrbitControls, SmoothControls assumes that the orientation of the camera
 * has been set in terms of position, rotation and scale, so it is important to
 * ensure that the camera's matrixWorld is in sync before using SmoothControls.
 */
export class SmoothControls extends EventDispatcher {
    constructor(camera, element) {
        super();
        this.camera = camera;
        this.element = element;
        this.sensitivity = 1;
        this._interactionEnabled = false;
        this._disableZoom = false;
        this.isUserChange = false;
        this.isUserPointing = false;
        // Internal orbital position state
        this.spherical = new Spherical();
        this.goalSpherical = new Spherical();
        this.thetaDamper = new Damper();
        this.phiDamper = new Damper();
        this.radiusDamper = new Damper();
        this.logFov = Math.log(DEFAULT_OPTIONS.maximumFieldOfView);
        this.goalLogFov = this.logFov;
        this.fovDamper = new Damper();
        // Pointer state
        this.pointerIsDown = false;
        this.lastPointerPosition = {
            clientX: 0,
            clientY: 0,
        };
        this.touchMode = 'rotate';
        this.touchDecided = false;
        this.onPointerMove = (event) => {
            if (!this.pointerIsDown || !this.canInteract) {
                return;
            }
            // NOTE(cdata): We test event.type as some browsers do not have a global
            // TouchEvent contructor.
            if (TOUCH_EVENT_RE.test(event.type)) {
                const { touches } = event;
                switch (this.touchMode) {
                    case 'zoom':
                        if (this.lastTouches.length > 1 && touches.length > 1) {
                            const lastTouchDistance = this.twoTouchDistance(this.lastTouches[0], this.lastTouches[1]);
                            const touchDistance = this.twoTouchDistance(touches[0], touches[1]);
                            const deltaZoom = ZOOM_SENSITIVITY * (lastTouchDistance - touchDistance) / 10.0;
                            this.userAdjustOrbit(0, 0, deltaZoom);
                        }
                        break;
                    case 'rotate':
                        const { touchAction } = this._options;
                        if (!this.touchDecided && touchAction !== 'none') {
                            this.touchDecided = true;
                            const { clientX, clientY } = touches[0];
                            const dx = Math.abs(clientX - this.lastPointerPosition.clientX);
                            const dy = Math.abs(clientY - this.lastPointerPosition.clientY);
                            // If motion is mostly vertical, assume scrolling is the intent.
                            if ((touchAction === 'pan-y' && dy > dx) ||
                                (touchAction === 'pan-x' && dx > dy)) {
                                this.touchMode = 'scroll';
                                return;
                            }
                        }
                        this.handleSinglePointerMove(touches[0]);
                        break;
                    case 'scroll':
                        return;
                    default:
                        break;
                }
                this.lastTouches = touches;
            }
            else {
                this.handleSinglePointerMove(event);
            }
            if (event.cancelable) {
                event.preventDefault();
            }
        };
        this.onPointerDown = (event) => {
            this.pointerIsDown = true;
            this.isUserPointing = false;
            if (TOUCH_EVENT_RE.test(event.type)) {
                const { touches } = event;
                this.touchDecided = false;
                switch (touches.length) {
                    default:
                    case 1:
                        this.touchMode = 'rotate';
                        this.handleSinglePointerDown(touches[0]);
                        break;
                    case 2:
                        this.touchMode = this._disableZoom ? 'scroll' : 'zoom';
                        break;
                }
                this.lastTouches = touches;
            }
            else {
                this.handleSinglePointerDown(event);
            }
        };
        this.onPointerUp = (_event) => {
            this.element.style.cursor = 'grab';
            this.pointerIsDown = false;
            if (this.isUserPointing) {
                this.dispatchEvent({ type: 'pointer-change-end', pointer: Object.assign({}, this.lastPointerPosition) });
            }
        };
        this.onWheel = (event) => {
            if (!this.canInteract) {
                return;
            }
            const deltaZoom = event.deltaY *
                (event.deltaMode == 1 ? 18 : 1) * ZOOM_SENSITIVITY / 30;
            this.userAdjustOrbit(0, 0, deltaZoom);
            if (event.cancelable) {
                event.preventDefault();
            }
        };
        this.onKeyDown = (event) => {
            // We track if the key is actually one we respond to, so as not to
            // accidentally clober unrelated key inputs when the <model-viewer> has
            // focus.
            let relevantKey = false;
            switch (event.keyCode) {
                case KeyCode.PAGE_UP:
                    relevantKey = true;
                    this.userAdjustOrbit(0, 0, ZOOM_SENSITIVITY);
                    break;
                case KeyCode.PAGE_DOWN:
                    relevantKey = true;
                    this.userAdjustOrbit(0, 0, -1 * ZOOM_SENSITIVITY);
                    break;
                case KeyCode.UP:
                    relevantKey = true;
                    this.userAdjustOrbit(0, -KEYBOARD_ORBIT_INCREMENT, 0);
                    break;
                case KeyCode.DOWN:
                    relevantKey = true;
                    this.userAdjustOrbit(0, KEYBOARD_ORBIT_INCREMENT, 0);
                    break;
                case KeyCode.LEFT:
                    relevantKey = true;
                    this.userAdjustOrbit(-KEYBOARD_ORBIT_INCREMENT, 0, 0);
                    break;
                case KeyCode.RIGHT:
                    relevantKey = true;
                    this.userAdjustOrbit(KEYBOARD_ORBIT_INCREMENT, 0, 0);
                    break;
                default:
                    break;
            }
            if (relevantKey && event.cancelable) {
                event.preventDefault();
            }
        };
        this._options = Object.assign({}, DEFAULT_OPTIONS);
        this.setOrbit(0, Math.PI / 2, 1);
        this.setFieldOfView(100);
        this.jumpToGoal();
    }
    get interactionEnabled() {
        return this._interactionEnabled;
    }
    enableInteraction() {
        if (this._interactionEnabled === false) {
            const { element } = this;
            element.addEventListener('mousemove', this.onPointerMove);
            element.addEventListener('mousedown', this.onPointerDown);
            if (!this._disableZoom) {
                element.addEventListener('wheel', this.onWheel);
            }
            element.addEventListener('keydown', this.onKeyDown);
            element.addEventListener('touchstart', this.onPointerDown, { passive: true });
            element.addEventListener('touchmove', this.onPointerMove);
            self.addEventListener('mouseup', this.onPointerUp);
            self.addEventListener('touchend', this.onPointerUp);
            this.element.style.cursor = 'grab';
            this._interactionEnabled = true;
        }
    }
    disableInteraction() {
        if (this._interactionEnabled === true) {
            const { element } = this;
            element.removeEventListener('mousemove', this.onPointerMove);
            element.removeEventListener('mousedown', this.onPointerDown);
            if (!this._disableZoom) {
                element.removeEventListener('wheel', this.onWheel);
            }
            element.removeEventListener('keydown', this.onKeyDown);
            element.removeEventListener('touchstart', this.onPointerDown);
            element.removeEventListener('touchmove', this.onPointerMove);
            self.removeEventListener('mouseup', this.onPointerUp);
            self.removeEventListener('touchend', this.onPointerUp);
            element.style.cursor = '';
            this._interactionEnabled = false;
        }
    }
    /**
     * The options that are currently configured for the controls instance.
     */
    get options() {
        return this._options;
    }
    set disableZoom(disable) {
        if (this._disableZoom != disable) {
            this._disableZoom = disable;
            if (disable === true) {
                this.element.removeEventListener('wheel', this.onWheel);
            }
            else {
                this.element.addEventListener('wheel', this.onWheel);
            }
        }
    }
    /**
     * Copy the spherical values that represent the current camera orbital
     * position relative to the configured target into a provided Spherical
     * instance. If no Spherical is provided, a new Spherical will be allocated
     * to copy the values into. The Spherical that values are copied into is
     * returned.
     */
    getCameraSpherical(target = new Spherical()) {
        return target.copy(this.spherical);
    }
    /**
     * Returns the camera's current vertical field of view in degrees.
     */
    getFieldOfView() {
        return this.camera.fov;
    }
    /**
     * Configure the _options of the controls. Configured _options will be
     * merged with whatever _options have already been configured for this
     * controls instance.
     */
    applyOptions(_options) {
        Object.assign(this._options, _options);
        // Re-evaluates clamping based on potentially new values for min/max
        // polar, azimuth and radius:
        this.setOrbit();
        this.setFieldOfView(Math.exp(this.goalLogFov));
    }
    /**
     * Sets the near and far planes of the camera.
     */
    updateNearFar(nearPlane, farPlane) {
        this.camera.near = Math.max(nearPlane, farPlane / 1000);
        this.camera.far = farPlane;
        this.camera.updateProjectionMatrix();
    }
    /**
     * Sets the aspect ratio of the camera
     */
    updateAspect(aspect) {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
    }
    /**
     * Set the absolute orbital goal of the camera. The change will be
     * applied over a number of frames depending on configured acceleration and
     * dampening _options.
     *
     * Returns true if invoking the method will result in the camera changing
     * position and/or rotation, otherwise false.
     */
    setOrbit(goalTheta = this.goalSpherical.theta, goalPhi = this.goalSpherical.phi, goalRadius = this.goalSpherical.radius) {
        const { minimumAzimuthalAngle, maximumAzimuthalAngle, minimumPolarAngle, maximumPolarAngle, minimumRadius, maximumRadius } = this._options;
        const { theta, phi, radius } = this.goalSpherical;
        const nextTheta = clamp(goalTheta, minimumAzimuthalAngle, maximumAzimuthalAngle);
        if (!isFinite(minimumAzimuthalAngle) &&
            !isFinite(maximumAzimuthalAngle)) {
            this.spherical.theta =
                this.wrapAngle(this.spherical.theta - nextTheta) + nextTheta;
        }
        const nextPhi = clamp(goalPhi, minimumPolarAngle, maximumPolarAngle);
        const nextRadius = clamp(goalRadius, minimumRadius, maximumRadius);
        if (nextTheta === theta && nextPhi === phi && nextRadius === radius) {
            return false;
        }
        this.goalSpherical.theta = nextTheta;
        this.goalSpherical.phi = nextPhi;
        this.goalSpherical.radius = nextRadius;
        this.goalSpherical.makeSafe();
        this.isUserChange = false;
        return true;
    }
    /**
     * Subset of setOrbit() above, which only sets the camera's radius.
     */
    setRadius(radius) {
        this.goalSpherical.radius = radius;
        this.setOrbit();
    }
    /**
     * Sets the goal field of view for the camera
     */
    setFieldOfView(fov) {
        const { minimumFieldOfView, maximumFieldOfView } = this._options;
        fov = clamp(fov, minimumFieldOfView, maximumFieldOfView);
        this.goalLogFov = Math.log(fov);
    }
    /**
     * Sets the smoothing decay time.
     */
    setDamperDecayTime(decayMilliseconds) {
        this.thetaDamper.setDecayTime(decayMilliseconds);
        this.phiDamper.setDecayTime(decayMilliseconds);
        this.radiusDamper.setDecayTime(decayMilliseconds);
        this.fovDamper.setDecayTime(decayMilliseconds);
    }
    /**
     * Adjust the orbital position of the camera relative to its current orbital
     * position. Does not let the theta goal get more than pi ahead of the current
     * theta, which ensures interpolation continues in the direction of the delta.
     * The deltaZoom parameter adjusts both the field of view and the orbit radius
     * such that they progress across their allowed ranges in sync.
     */
    adjustOrbit(deltaTheta, deltaPhi, deltaZoom) {
        const { theta, phi, radius } = this.goalSpherical;
        const { minimumRadius, maximumRadius, minimumFieldOfView, maximumFieldOfView } = this._options;
        const dTheta = this.spherical.theta - theta;
        const dThetaLimit = Math.PI - 0.001;
        const goalTheta = theta - clamp(deltaTheta, -dThetaLimit - dTheta, dThetaLimit - dTheta);
        const goalPhi = phi - deltaPhi;
        const deltaRatio = deltaZoom === 0 ?
            0 :
            ((deltaZoom > 0 ? maximumRadius : minimumRadius) - radius) /
                (Math.log(deltaZoom > 0 ? maximumFieldOfView : minimumFieldOfView) -
                    this.goalLogFov);
        const goalRadius = radius +
            deltaZoom *
                Math.min(isFinite(deltaRatio) ? deltaRatio : Infinity, maximumRadius - minimumRadius);
        this.setOrbit(goalTheta, goalPhi, goalRadius);
        if (deltaZoom !== 0) {
            const goalLogFov = this.goalLogFov + deltaZoom;
            this.setFieldOfView(Math.exp(goalLogFov));
        }
    }
    /**
     * Move the camera instantly instead of accelerating toward the goal
     * parameters.
     */
    jumpToGoal() {
        this.update(0, SETTLING_TIME);
    }
    /**
     * Update controls. In most cases, this will result in the camera
     * interpolating its position and rotation until it lines up with the
     * designated goal orbital position.
     *
     * Time and delta are measured in milliseconds.
     */
    update(_time, delta) {
        if (this.isStationary()) {
            return;
        }
        const { maximumPolarAngle, maximumRadius } = this._options;
        const dTheta = this.spherical.theta - this.goalSpherical.theta;
        if (Math.abs(dTheta) > Math.PI &&
            !isFinite(this._options.minimumAzimuthalAngle) &&
            !isFinite(this._options.maximumAzimuthalAngle)) {
            this.spherical.theta -= Math.sign(dTheta) * 2 * Math.PI;
        }
        this.spherical.theta = this.thetaDamper.update(this.spherical.theta, this.goalSpherical.theta, delta, Math.PI);
        this.spherical.phi = this.phiDamper.update(this.spherical.phi, this.goalSpherical.phi, delta, maximumPolarAngle);
        this.spherical.radius = this.radiusDamper.update(this.spherical.radius, this.goalSpherical.radius, delta, maximumRadius);
        this.logFov = this.fovDamper.update(this.logFov, this.goalLogFov, delta, 1);
        this.moveCamera();
    }
    isStationary() {
        return this.goalSpherical.theta === this.spherical.theta &&
            this.goalSpherical.phi === this.spherical.phi &&
            this.goalSpherical.radius === this.spherical.radius &&
            this.goalLogFov === this.logFov;
    }
    moveCamera() {
        // Derive the new camera position from the updated spherical:
        this.spherical.makeSafe();
        this.camera.position.setFromSpherical(this.spherical);
        this.camera.setRotationFromEuler(new Euler(this.spherical.phi - Math.PI / 2, this.spherical.theta, 0, 'YXZ'));
        if (this.camera.fov !== Math.exp(this.logFov)) {
            this.camera.fov = Math.exp(this.logFov);
            this.camera.updateProjectionMatrix();
        }
        const source = this.isUserChange ? ChangeSource.USER_INTERACTION : ChangeSource.NONE;
        this.dispatchEvent({ type: 'change', source });
    }
    get canInteract() {
        if (this._options.interactionPolicy == 'allow-when-focused') {
            const rootNode = this.element.getRootNode();
            return rootNode.activeElement === this.element;
        }
        return this._options.interactionPolicy === 'always-allow';
    }
    userAdjustOrbit(deltaTheta, deltaPhi, deltaZoom) {
        this.adjustOrbit(deltaTheta * this.sensitivity, deltaPhi * this.sensitivity, deltaZoom);
        this.isUserChange = true;
        // Always make sure that an initial event is triggered in case there is
        // contention between user interaction and imperative changes. This initial
        // event will give external observers that chance to observe that
        // interaction occurred at all:
        this.dispatchEvent({ type: 'change', source: ChangeSource.USER_INTERACTION });
    }
    // Wraps to bewteen -pi and pi
    wrapAngle(radians) {
        const normalized = (radians + Math.PI) / (2 * Math.PI);
        const wrapped = normalized - Math.floor(normalized);
        return wrapped * 2 * Math.PI - Math.PI;
    }
    pixelLengthToSphericalAngle(pixelLength) {
        return 2 * Math.PI * pixelLength / this.element.clientHeight;
    }
    twoTouchDistance(touchOne, touchTwo) {
        const { clientX: xOne, clientY: yOne } = touchOne;
        const { clientX: xTwo, clientY: yTwo } = touchTwo;
        const xDelta = xTwo - xOne;
        const yDelta = yTwo - yOne;
        return Math.sqrt(xDelta * xDelta + yDelta * yDelta);
    }
    handleSinglePointerMove(pointer) {
        const { clientX, clientY } = pointer;
        const deltaTheta = this.pixelLengthToSphericalAngle(clientX - this.lastPointerPosition.clientX);
        const deltaPhi = this.pixelLengthToSphericalAngle(clientY - this.lastPointerPosition.clientY);
        this.lastPointerPosition.clientX = clientX;
        this.lastPointerPosition.clientY = clientY;
        if (this.isUserPointing === false) {
            this.isUserPointing = true;
            this.dispatchEvent({ type: 'pointer-change-start', pointer: Object.assign({}, pointer) });
        }
        this.userAdjustOrbit(deltaTheta, deltaPhi, 0);
    }
    handleSinglePointerDown(pointer) {
        this.lastPointerPosition.clientX = pointer.clientX;
        this.lastPointerPosition.clientY = pointer.clientY;
        this.element.style.cursor = 'grabbing';
    }
}
//# sourceMappingURL=SmoothControls.js.map