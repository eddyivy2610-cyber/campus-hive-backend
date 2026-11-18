export function isDatabaseUnavailable(err: any): boolean {
  const code = String(err?.code || "");
  const msg = String(err?.message || "").toLowerCase();
  return (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "P1001" ||
    code === "P1002" ||
    code === "P1008" ||
    code === "P1017" ||
    code === "57P01" ||
    code === "57P03" ||
    msg.includes("econnrefused") ||
    msg.includes("connection terminated") ||
    msg.includes("can't reach database server") ||
    msg.includes("terminating connection")
  );
}
