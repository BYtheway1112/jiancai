export function Logo() {
  // browser.runtime.getURL throws in invalidated extension contexts; degrade to no icon.
  let src = "";
  try { src = browser.runtime.getURL("/icon/48.png"); } catch {}
  return (<img src={src} className="hover:cursor-pointer size-8" alt="社媒助手" onClick={() => {
    sendMessage("openPopup", undefined);
  }}></img>);
}