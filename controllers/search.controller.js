import { searchProfiles } from "../services/search.service.js";

export const search = async (req, res) => {
  const query = (req.query.q || "").toString().trim();
  const type = (req.query.type || "").toString().toLowerCase();

  if (!query) {
    return res.status(400).json({ message: "Search query (q) is required" });
  }

  const payload = {
    profiles: []
  };

  if (!type || type === "profiles") {
    payload.profiles = await searchProfiles(query);
  }

  return res.status(200).json(payload);
};
