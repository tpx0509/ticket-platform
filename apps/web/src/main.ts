import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { createApp } from 'vue'

import 'element-plus/dist/index.css'
import './styles.css'

import App from './App.vue'
import router from './router'

const app = createApp(App)

// locale 不改的话分页、日期选择器全是英文
app.use(ElementPlus, { locale: zhCn })
app.use(router)
app.mount('#app')
