// Keyboard, mouse and pointer lock. The simulation reads plain state (the keys
// set, accumulated look deltas, edge-triggered presses) so input stays apart
// from the rules that use it.
export function createInput(element, onLockChange) {
  const state = {
    keys: new Set(),
    lookX: 0,
    lookY: 0,
    firing: false,
    aiming: false,
    locked: false,
    wheel: 0,
  };
  const pressed = new Set();
  let locked = false;

  function onKeyDown(event) {
    if (event.repeat) return;
    state.keys.add(event.code);
    pressed.add(event.code);
    if (event.code === 'Tab') event.preventDefault();
  }
  function onKeyUp(event) {
    state.keys.delete(event.code);
  }
  function onMouseMove(event) {
    if (!locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  }
  function onMouseDown(event) {
    if (!locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  }
  function onWheel(event) {
    if (locked) state.wheel += Math.sign(event.deltaY);
  }
  function onLock() {
    locked = document.pointerLockElement === element;
    state.locked = locked;
    if (!locked) {
      state.firing = false;
      state.aiming = false;
      state.keys.clear();
    }
    onLockChange(locked);
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('wheel', onWheel, { passive: true });
  document.addEventListener('pointerlockchange', onLock);
  element.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    state,
    requestLock() {
      element.requestPointerLock();
    },
    exitLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    takeWheel() {
      const w = state.wheel;
      state.wheel = 0;
      return w;
    },
    // Edge-triggered: true once for the frame the key went down.
    wasPressed(code) {
      return pressed.has(code);
    },
    endFrame() {
      pressed.clear();
    },
  };
}
