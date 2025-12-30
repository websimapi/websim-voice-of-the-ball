// Sensor Manager for 6DoF-ish tracking
export class SensorController {
    constructor() {
        this.lastX = 0;
        this.lastY = 0;
        this.lastZ = 0;
        this.callbacks = {
            swing: null,
            orientation: null
        };
        this.swingThreshold = 15; // m/s^2 acceleration threshold
        this.cooldown = false;
    }

    async requestPermission() {
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            try {
                const response = await DeviceMotionEvent.requestPermission();
                if (response === 'granted') {
                    return true;
                } else {
                    alert('Permission denied. Game cannot work without sensors.');
                    return false;
                }
            } catch (e) {
                console.error(e);
                return false;
            }
        }
        return true; // Non-iOS devices usually don't need permission
    }

    start(onSwing) {
        this.callbacks.swing = onSwing;
        window.addEventListener('devicemotion', this.handleMotion.bind(this));
    }

    handleMotion(event) {
        if (this.cooldown) return;

        // Use accelerationIncludingGravity for "tilt" or acceleration for "force"
        // For a flick/swing, linear acceleration (without gravity) is best
        const acc = event.acceleration; 
        if (!acc) return; // Some devices return null initially

        const x = acc.x || 0;
        const y = acc.y || 0;
        const z = acc.z || 0;

        // Calculate magnitude of acceleration vector
        const magnitude = Math.sqrt(x*x + y*y + z*z);

        if (magnitude > this.swingThreshold) {
            this.triggerSwing(magnitude);
        }
    }

    triggerSwing(force) {
        this.cooldown = true;
        
        // Vibration feedback for the swing itself
        if (navigator.vibrate) navigator.vibrate(50);

        if (this.callbacks.swing) {
            this.callbacks.swing(force);
        }

        // Prevent double hits
        setTimeout(() => {
            this.cooldown = false;
        }, 500);
    }
}