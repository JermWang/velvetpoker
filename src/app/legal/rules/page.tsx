export const metadata = { title: "Game Rules" };

export default function RulesPage() {
  return (
    <>
      <h1>Game Rules — Texas Hold&apos;em</h1>
      <p>
        Velvet runs No-Limit Texas Hold&apos;em cash games for two to nine
        players. Gameplay is server-authoritative; the deck, betting, and pot
        logic are enforced by the server and cannot be altered by a table host.
      </p>

      <h2>The deal</h2>
      <p>
        Each player receives two private hole cards. Five community cards are
        dealt across the flop (three), turn (one), and river (one). The best
        five-card hand wins.
      </p>

      <h2>Betting</h2>
      <ul>
        <li>Small and big blinds are posted each hand.</li>
        <li>Actions: fold, check, call, bet, raise, and all-in.</li>
        <li>Minimum raise equals the size of the previous bet or raise.</li>
        <li>All-ins create side pots; only eligible players contest each pot.</li>
        <li>Ties split the pot; odd chips go to the first seat left of the button.</li>
      </ul>

      <h2>Provably fair shuffle</h2>
      <p>
        Before each hand the server publishes a hash of its secret seed. Players
        may contribute optional client seeds. The deck is derived
        deterministically from the server seed, table and hand identifiers, and
        all client seeds. After the hand the server reveals its seed so anyone
        can recompute the deck and confirm it was never altered.
      </p>

      <h2>Timeouts &amp; disconnects</h2>
      <p>
        Each decision has an action timer. If it expires, the hand checks when
        free or folds when facing a bet. Disconnected players are timed out the
        same way and may rejoin between hands.
      </p>

      <h2>Rake</h2>
      <p>
        Where applicable, rake is a transparent percentage of contested pots,
        capped per hand, and recorded in the ledger. The displayed table
        configuration always states the rake in effect.
      </p>
    </>
  );
}
