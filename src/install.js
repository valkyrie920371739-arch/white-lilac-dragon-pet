const installButton = document.getElementById('install-button');
const installStatus = document.getElementById('install-status');

// A browser cannot read the client's installation or selection result.
// Keep the native link usable even when JavaScript or app detection is unavailable.
installButton?.addEventListener('click', () => {
  installStatus.textContent = '正在请求打开 ChatGPT。请在客户端确认安装并选择她；若没有打开，请展开下方帮助。';
});
