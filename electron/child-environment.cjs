// Windows child environments are case-insensitive, unlike a copied JS object.
function childEnvironment(key, inherited = process.env) {
  const env = Object.fromEntries(
    Object.entries(inherited).filter(
      ([name]) =>
        !['NEXUS_API_KEY', 'NEXUS_OAUTH_INFO'].includes(name.toUpperCase()),
    ),
  );
  if (key) env.NEXUS_API_KEY = key;
  return env;
}
module.exports = { childEnvironment };
