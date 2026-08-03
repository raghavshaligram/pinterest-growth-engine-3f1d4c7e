// Can this board publish through this Pinterest connection?
//
// One definition, because three places have to agree on it and any
// disagreement is invisible until Pinterest rejects a pin:
//
//   1. Selection   — buildPlanner (lib/schedule.functions.ts) and the
//                    nightly materializer, deciding which board a new
//                    scheduled_pins row gets.
//   2. Publishing  — processDuePinsForUser (lib/publisher.server.ts),
//                    re-validating the board_id a row was assigned
//                    possibly weeks earlier.
//   3. Reporting   — listScheduled, flagging rows the Schedule screen
//                    should mark as needing a new board.
//
// Before this existed, (1) had the rule and (2) and (3) had nothing:
// board_id was chosen once at row creation and trusted forever. A row
// created under older rules, or whose board lost its connection tag
// afterwards, published straight into a
//   403 {"code":29,"message":"You are not permitted to access that resource."}
//
// THE RULE: possession of proof, not absence of contradiction.
//
// A board qualifies only when it is tagged with the exact connection
// being published through. The one exception is a board with no
// pinterest_board_id at all — it is never sent to Pinterest's API
// (webhook mode forwards it to the user's own automation; api mode
// already fails fast on it), so it cannot cross accounts.
//
// What is deliberately NOT accepted:
//
// - "The account only has one connection, so an untagged board must
//   belong to it." False, and it is the exact shape that produced the
//   bug report: a board added by hand carrying a production board id,
//   on an account whose only connection was Sandbox. Sandbox and
//   production are separate namespaces with non-interchangeable tokens
//   (see pinterest-environment.ts), so a single connection guarantees
//   nothing about an untagged board's origin.
//
// - "It was fine last time." boards.pinterest_connection_id is
//   ON DELETE SET NULL, so disconnecting a Pinterest connection strips
//   the origin tag off every board it ever synced and silently converts
//   proven boards into unprovable ones. This state is manufactured by
//   normal use, not just by hand-adding boards.
//
// The migration path for a board that lost its tag is a re-sync:
// syncPinterestBoards re-tags on every sync, not just on insert. A board
// that no longer exists in the connection being synced simply stays
// untagged — correctly, since it genuinely cannot be published there.

export type BoardOwnership = {
  pinterest_connection_id: string | null;
  pinterest_board_id: string | null;
};

export function boardCanPublishVia(
  board: BoardOwnership,
  connectionId: string | null,
): boolean {
  // No pinterest_board_id: nothing is ever sent to Pinterest's API for
  // this board, so it cannot address the wrong account.
  if (!board.pinterest_board_id) return true;
  // A real board id needs a proven owner, and that owner must be the
  // connection doing the publishing.
  if (!connectionId) return false;
  return board.pinterest_connection_id === connectionId;
}

// Why a board was rejected, for messages that tell the user what to do
// rather than restating that something failed.
export type BoardRejection = "untagged" | "other-connection" | "site-unmapped";

export function boardRejectionReason(
  board: BoardOwnership,
  connectionId: string | null,
): BoardRejection | null {
  if (boardCanPublishVia(board, connectionId)) return null;
  if (!connectionId) return "site-unmapped";
  return board.pinterest_connection_id ? "other-connection" : "untagged";
}

// The user-facing explanation. Names the actual problem — which account
// the board belongs to — instead of surfacing Pinterest's own
// "not permitted to access that resource", which reads like a
// permissions bug in their Pinterest account rather than a mismatch
// this app created.
export function boardRejectionMessage(
  reason: BoardRejection,
  ctx: { boardName?: string | null; siteName?: string | null } = {},
): string {
  const board = ctx.boardName ? `"${ctx.boardName}"` : "This pin's board";
  const site = ctx.siteName ? ctx.siteName : "this site";
  switch (reason) {
    case "site-unmapped":
      return `${site} isn't mapped to a Pinterest account, so there is no account to publish ${board} through.`;
    case "other-connection":
      return `${board} belongs to a different Pinterest account than ${site} publishes through. Reassign this pin to one of that account's boards, or remap the site.`;
    case "untagged":
      return `${board} isn't linked to any connected Pinterest account — most often because the account it was synced from has since been disconnected, or because it was added by hand. Run "Sync from Pinterest" on the Boards page for ${site}'s account, then reassign this pin to one of its boards.`;
  }
}

// Why a whole SITE produced no scheduled pins on a bulk run.
//
// autoSchedule and the nightly materializer both loop over briefs and
// `continue` past any whose site has nothing to schedule to. That skip
// used to be silent: the run reported "scheduled N" counting other
// sites, and a site that could never be scheduled generated no error, no
// warning and no log line — indefinitely. Tightening board eligibility
// makes the no-boards case more common, not less, so the skip now has to
// account for itself.
export type SiteSkipReason = "no-eligible-boards" | "no-safe-slot";

export function siteSkipMessage(reason: SiteSkipReason, siteName: string): string {
  switch (reason) {
    case "no-eligible-boards":
      return `${siteName}: no board belongs to its Pinterest account, so nothing could be scheduled. Sync boards for that account.`;
    case "no-safe-slot":
      return `${siteName}: no slot in the planning window cleared the posting-safety limits, so nothing was scheduled.`;
  }
}
