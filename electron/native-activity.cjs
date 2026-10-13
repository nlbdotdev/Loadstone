// Ephemeral, path-free phase progress. File bytes are bounded by the recipe;
// no source names, configuration values or credentials enter this callback.
function nativeActivity(callback, phase, total) {
  let completed = 0,
    bytes = 0,
    totalBytes = 0,
    last = 0;
  function emit(force = false) {
    const now = Date.now();
    if (!force && now - last < 250) return;
    last = now;
    callback?.({ phase, completed, total, bytes, totalBytes });
  }
  emit(true);
  return {
    start(size) {
      bytes = 0;
      totalBytes = size;
      emit(true);
    },
    add(size) {
      bytes += size;
      emit();
    },
    finish() {
      completed++;
      emit(true);
    },
  };
}
module.exports = { nativeActivity };
