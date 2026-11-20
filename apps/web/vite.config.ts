import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * 没配 proxy，接口是浏览器直连 http://localhost:4800。
 *
 * 这样跨域问题会真实暴露出来 —— 后端没开 CORS 的话浏览器直接拦掉，
 * 控制台报 "No 'Access-Control-Allow-Origin' header"。
 * 配 proxy 能让它「看起来正常」，但那是开发服务器在替你转发，
 * 线上没这层，等于把问题藏起来了。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // 显式写 127.0.0.1：默认只监听 ::1（IPv6），部分工具和 curl 连不上。
    // 浏览器访问 http://localhost:5173 时会自动回退到 IPv4，不影响使用。
    //
    // 注意：地址栏必须写 localhost，不能写 127.0.0.1。
    // refresh_token 是 SameSite=Lax 的 cookie，127.0.0.1 和 localhost 属于不同的站，
    // 页面开在 127.0.0.1 时换签请求带不上 cookie，token 一过期就被踢回登录页。
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
})
