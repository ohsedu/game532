import Loading from "@/components/Loading";

/**
 * Shown while any route below the root layout is being fetched.
 *
 * Without this boundary a click on 게임 선택 or 랭킹 보기 did nothing visible
 * until the new page arrived — the browser stays on the old screen while React
 * waits, so the site looked like it had ignored the tap. Both destinations read
 * the database on every request (revalidate = 0), so that gap is real and
 * lands on exactly the two links a player uses between runs.
 *
 * One boundary at the root covers every route. The game pages are prerendered
 * and come from the router cache, so they never reach it.
 */
export default function RouteLoading() {
  return <Loading />;
}
