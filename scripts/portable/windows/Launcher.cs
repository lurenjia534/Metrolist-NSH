// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Diagnostics;
using System.IO;

internal static class Launcher
{
    [STAThread]
    private static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string gateway = Path.Combine(root, "gateway", "launch.mjs");
        var start = new ProcessStartInfo
        {
            FileName = Path.Combine(root, "runtime", "node.exe"),
            Arguments = "--use-env-proxy --max-http-header-size=65536 \"" + gateway + "\"" +
                (args.Length == 1 && args[0] == "--check" ? " --check" : ""),
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using (var process = Process.Start(start))
        {
            process.WaitForExit();
            return process.ExitCode;
        }
    }
}
