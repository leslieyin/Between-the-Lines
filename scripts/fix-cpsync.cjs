/**
 * 修掉 Node 在 Windows 下的一个静默失败：fs.cpSync 递归复制时，只要**目标路径含非 ASCII 字符**，
 * 它就会一个文件都不复制、而且不报错。
 *
 * 实测（Node 22.22.2 / Windows）：
 *   目标 ASCII         -> cpSync 正常
 *   目标含中文          -> cpSync 复制 0 个文件，无异常
 *   目标含中文 + copyFileSync 单文件 -> 正常
 *
 * 为什么这会挡住部署：@opennextjs/aws 的 initOutputDir() 正是用
 *   fs.cpSync(tempBuildDir, "<项目>/.open-next/.build", { recursive: true })
 * 把编译好的 open-next.config.mjs / .mjs.edge 搬进构建目录。目标为空之后，
 * 下一步 createMiddleware() 找不到 open-next.config.edge.mjs，直接 ENOENT 崩掉。
 * 而本机项目路径是 D:\Leslie\github工具\dongta —— 含「工具」两个字。
 *
 * 做法：把 cpSync 换成一个用 copyFileSync 实现的等价递归复制。因为 copyFileSync 在这个环境下是好的，
 * 而且它在语义上就是 cpSync 的子集，替换是安全的。
 *
 * 只在 win32 上生效，且只作用于构建进程（通过 NODE_OPTIONS=--require 预加载）。
 */

if (process.platform === "win32") {
  const fs = require("node:fs");
  const nodePath = require("node:path");

  const nativeCpSync = fs.cpSync;

  function copyRecursive(source, destination, filter) {
    const stats = fs.lstatSync(source);

    if (stats.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(source);
      fs.symlinkSync(linkTarget, destination);
      return;
    }

    if (stats.isDirectory()) {
      fs.mkdirSync(destination, { recursive: true });
      for (const entry of fs.readdirSync(source)) {
        const from = nodePath.join(source, entry);
        const to = nodePath.join(destination, entry);
        if (typeof filter === "function" && !filter(from, to)) continue;
        copyRecursive(from, to, filter);
      }
      return;
    }

    fs.mkdirSync(nodePath.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  fs.cpSync = function cpSyncPatched(source, destination, options = {}) {
    // 目标路径全是 ASCII 时走原生实现，别去动它
    if (/^[\x20-\x7e]*$/.test(String(destination))) {
      return nativeCpSync(source, destination, options);
    }
    copyRecursive(source, destination, options.filter);
  };

  // 只在真正被替换时提示一次，避免污染构建输出
  if (process.env.HW_BUILD_TRACE === "1") {
    console.log("[fix-cpsync] fs.cpSync 已替换为 copyFileSync 实现（目标路径含非 ASCII 字符）");
  }
}
