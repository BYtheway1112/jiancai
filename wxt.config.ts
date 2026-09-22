import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  outDir: "output",
  manifest: {
    name: '简采 · 小红书与抖音作品采集',
    description: '小红书与抖音作品采集，导出 Excel、同步飞书多维表格和导入 Eagle。',
    version: '0.2.10',
    version_name: '0.2.10',
    default_locale: 'zh_CN',
    host_permissions: ["*://*.xiaohongshu.com/*", "*://*.douyin.com/*", "http://localhost/*", "https://open.feishu.cn/*", "https://*.xhscdn.com/*", "https://*.douyinvod.com/*", "https://*.douyinstatic.com/*", "https://*.douyinpic.com/*", "https://*.byteimg.com/*", "https://*.ibytedtos.com/*", "https://*.pstatp.com/*", "https://*.snssdk.com/*", "https://*.bytecdn.cn/*"],
    permissions: ["activeTab", "downloads", "scripting", "storage"],
    web_accessible_resources: [{ resources: ["/icon/*"], matches: ["<all_urls>"] }],
  }
});
