# B站 UP 主播放量监测

这是一个可直接上传到 GitHub，并连接 Vercel 部署的小项目。

## 文件结构

```text
.
├── index.html
├── api/
│   └── bili.js
├── package.json
├── vercel.json
├── .gitignore
└── README.md
```

## 上传 GitHub

1. 新建一个 GitHub Repository。
2. 把这个文件夹里的所有文件上传到仓库根目录。
3. 注意：`index.html` 必须直接位于仓库根目录，不要再套一层文件夹。

## 部署 Vercel

1. 登录 Vercel。
2. 点击 Add New → Project。
3. 选择你的 GitHub 仓库。
4. Framework Preset 使用 Other 或保持自动识别。
5. Build Command 留空。
6. Output Directory 留空。
7. 点击 Deploy。
8. 完成后会获得 `https://项目名.vercel.app`。

## 数据存储

历史快照使用浏览器 localStorage。

因此：
- 同一台设备同一浏览器可以连续比较。
- 手机和电脑之间不会自动同步历史。
- 清理浏览器数据后历史也会消失。

## API

前端请求：

```text
/api/bili?uid=UP主UID
```

服务器端再访问 Bilibili，因此浏览器不直接请求 B站 API，可以规避浏览器 CORS 问题。

## 注意事项

B站第三方公开接口可能调整或触发临时风控。不要高频连续抓取。
