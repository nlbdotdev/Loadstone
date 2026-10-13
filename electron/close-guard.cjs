function protectActiveWork(app, window, dialog, activity) {
  let prompting = false;
  const guard = (event) => {
    const operation = activity();
    if (!operation) return;
    event.preventDefault();
    if (prompting || window.isDestroyed()) return;
    prompting = true;
    void dialog
      .showMessageBox(window, {
        type: 'info',
        title: 'Work is still in progress',
        message: operation.message,
        detail: operation.detail,
        buttons: ['Keep Loadstone open', 'Minimize'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 1 && !window.isDestroyed()) window.minimize();
      })
      .catch(() => {})
      .finally(() => {
        prompting = false;
      });
  };
  window.on('close', guard);
  app.on('before-quit', guard);
  window.once('closed', () => app.removeListener('before-quit', guard));
}

function currentActivity(installer, runtime, nativeBuilder, nativeLibrary) {
  if (nativeLibrary?.busy)
    return {
      message: 'A native library operation is still running.',
      detail:
        'Finish the selection or stop the operation in My library before closing. A stopped removal retains its remaining files for recovery.',
    };
  if (nativeBuilder?.busy)
    return {
      message: 'A native candidate is being prepared or built.',
      detail:
        'Finish the selection or cancel the build in Settings and wait for it to stop before closing. Any partial candidate folder is retained.',
    };
  if (installer?.maintenance)
    return {
      message: 'Setup removal is still running.',
      detail:
        'Wait for removal to finish before closing Loadstone. You can minimize the window while files are being cleaned up.',
    };
  if (installer?.starting || installer?.running)
    return {
      message: 'A setup installation is still running.',
      detail:
        'Wait for it to finish, or stop it in Downloads and wait for the stopped status before closing. Downloaded archives and partial files are kept for retry.',
    };
  if (runtime?.controller)
    return {
      message: 'The installation engine is being prepared.',
      detail:
        'Wait for preparation to finish, or cancel it in Settings and wait for it to stop before closing.',
    };
  return null;
}
module.exports = { protectActiveWork, currentActivity };
