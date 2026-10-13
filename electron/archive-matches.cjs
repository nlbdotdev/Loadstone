// Each member recorded here has already passed exact size/SHA-256 comparison.
// Keep a deterministic representative rather than a files × copies expansion.
function recordArchiveMatch(matches, identity, member) {
  const existing = matches.get(identity);
  if (existing) {
    existing.equivalentMembers++;
    if (member < existing.member) existing.member = member;
  } else matches.set(identity, { member, equivalentMembers: 1 });
}
module.exports = { recordArchiveMatch };
