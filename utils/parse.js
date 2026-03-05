export function parseDDMMYYYY(dateStr) {
  const [day, month, year] = dateStr.split("/").map(Number);

  if (!day || !month || !year) {
    throw new Error("Invalid date format. Expected DD/MM/YYYY");
  }

  // Month is 0-based in JS Date
  const date = new Date(year, month - 1, day);

  // Validate actual date (e.g. 31/02/2026)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error("Invalid calendar date");
  }

  return date;
}
