# Texas Hold'em Poker

一个基于 Next.js、TypeScript、Tailwind CSS 和 SQLite 的多人德州扑克小游戏。

项目支持 2–6 名已注册玩家创建私人牌桌，通过 WebSocket 实时同步牌局，并将账号、房间和已结束牌局保存在 SQLite 中。

## 功能

- 昵称注册与登录、头像上传、在线状态
- 私人房间、邀请、等待大厅和房主控制
- 2–6 人多人德州扑克
- 弃牌、过牌、跟注、加注和全下
- 边池、平局、A-2-3-4-5 顺子和牌局历史结算
- 支持 1–4 副牌、前注、盲注升级和自定义初始筹码
- 可选大小王、五条及特殊倍率规则
- WebSocket 实时同步和断线重连
- SQLite 持久化与在线备份

## 技术栈

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Node.js
- SQLite / better-sqlite3
- WebSocket

## 本地运行

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>，输入昵称即可创建或加入牌桌。

常用命令：

```bash
npm run typecheck        # TypeScript 类型检查
npm run build            # 生产构建
npm start                # 启动生产服务
npm run test:realtime    # 运行实时同步测试
npm run backup           # 在线备份 SQLite 数据库
```

## 配置

默认数据库路径为 `.data/poker.sqlite`。也可以通过环境变量指定绝对路径：

```bash
POKER_DB_PATH=/var/lib/texasholdem/poker.sqlite
```

生产环境建议使用 HTTPS，以启用浏览器 Web Crypto 和 WebRTC。可通过以下环境变量配置公网地址和 ICE 服务器：

```bash
POKER_PUBLIC_ORIGIN=https://poker.example.com
POKER_ICE_SERVERS='[{"urls":"stun:stun.cloudflare.com:3478"}]'
```

## 生产部署

```bash
npm install
npm run build
NODE_ENV=production npm start -- --hostname 127.0.0.1 --port 3000
```

反向代理需要支持 `/realtime` 的 WebSocket Upgrade。仓库中的 `deploy/texasholdem-poker.service` 提供了 systemd 服务示例。

不要让多个服务实例同时写入同一个 SQLite 文件。部署前请停止旧进程，并定期执行数据库备份。

## 项目结构

```text
app/       Next.js 页面、API 路由和界面组件
lib/       牌局引擎、数据库、房间和实时通信逻辑
public/    卡牌 SVG 资源
scripts/   数据库备份和房间清理脚本
tests/     实时通信测试
deploy/    生产部署配置
```

## 许可证

本项目以 MIT License 发布，详见 [LICENSE](LICENSE)。

Copyright (c) 2026 Super-Yael
