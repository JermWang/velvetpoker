import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "./site-theme";

const cards = ["10", "J", "Q", "K", "A"];

const features = [
  {
    eyebrow: "Access",
    title: "Wallet-only private rooms",
    copy: "Privy sign-in, Solana wallets, invite-first tables.",
    stat: "Private codes",
  },
  {
    eyebrow: "Gameplay",
    title: "Server-authoritative Hold'em",
    copy: "Real-time action, table-locked buy-ins, clean seat state.",
    stat: "Live table",
  },
  {
    eyebrow: "Money",
    title: "Ledgered balances",
    copy: "Deposits, withdrawals, reconciled double-entry accounting.",
    stat: "SOL + USDC",
  },
  {
    eyebrow: "Trust",
    title: "Verifiable hands",
    copy: "Commit-reveal shuffle proofs and hand history review.",
    stat: "Proof drawer",
  },
  {
    eyebrow: "Ops",
    title: "Admin and risk controls",
    copy: "Users, ledger, tables, withdrawals, hands, risk events.",
    stat: "Review queue",
  },
];

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

function ease(frame: number, start: number, duration: number): number {
  return interpolate(frame, [start, start + duration], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
}

function fadeWindow(frame: number, start: number, hold: number, fade = 18): number {
  const inP = interpolate(frame, [start, start + fade], [0, 1], clamp);
  const outP = interpolate(frame, [start + hold - fade, start + hold], [1, 0], clamp);
  return Math.min(inP, outP);
}

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: small ? 16 : 24 }}>
      <Img
        src={staticFile("velvet-poker-chip.png")}
        style={{
          width: small ? 58 : 92,
          height: small ? 58 : 92,
          objectFit: "contain",
          filter: "drop-shadow(0 8px 26px rgba(143,29,44,0.5))",
        }}
      />
      <div
        style={{
          fontFamily: theme.fonts.display,
          fontSize: small ? 38 : 76,
          lineHeight: 1,
          color: theme.colors.ivory,
          letterSpacing: 0,
        }}
      >
        Velvet<span style={{ color: theme.colors.velvetSoft }}>.</span>
      </div>
    </div>
  );
}

function Card({
  rank,
  index,
  frame,
}: {
  rank: string;
  index: number;
  frame: number;
}) {
  const spread = ease(frame, 20, 52);
  const lift = Math.sin((frame + index * 8) / 30) * 5;
  const x = interpolate(index, [0, 4], [-280, 280]) * spread;
  const y = interpolate(Math.abs(index - 2), [0, 2], [0, 58]) * spread + lift;
  const rot = interpolate(index, [0, 4], [-18, 18]) * spread;

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: 148,
        height: 206,
        borderRadius: 14,
        transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${rot}deg)`,
        background:
          "radial-gradient(125% 120% at 50% -8%, #faf8f1 0%, #f2eee2 70%, #e9e3d3 100%)",
        boxShadow:
          "0 34px 54px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.65), inset 0 0 0 1px rgba(120,100,60,0.12)",
        display: "grid",
        placeItems: "center",
        zIndex: index,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          fontFamily: theme.fonts.display,
          fontSize: 34,
          fontWeight: 700,
          color: theme.colors.charcoal900,
        }}
      >
        {rank}
      </div>
      <div
        style={{
          width: 76,
          height: 76,
          borderRadius: 18,
          display: "grid",
          placeItems: "center",
          border: `1px solid rgba(143,29,44,0.5)`,
          boxShadow: "0 0 0 6px rgba(19,21,26,0.08)",
          color: theme.colors.velvet,
          fontFamily: theme.fonts.display,
          fontSize: 48,
          fontWeight: 700,
        }}
      >
        V
      </div>
    </div>
  );
}

function GlassPanel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        borderRadius: theme.radius.xxl,
        border: "1px solid rgba(255,255,255,0.09)",
        background:
          "linear-gradient(160deg, rgba(255,255,255,0.065), rgba(255,255,255,0.015))",
        boxShadow:
          "0 30px 70px -26px rgba(0,0,0,0.78), inset 0 1px 0 rgba(255,255,255,0.08)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function FeatureCard({
  feature,
  index,
  active,
}: {
  feature: (typeof features)[number];
  index: number;
  active: number;
}) {
  const selected = index === Math.round(active);
  return (
    <GlassPanel
      style={{
        padding: 22,
        minHeight: 130,
        borderColor: selected ? "rgba(143,29,44,0.62)" : "rgba(255,255,255,0.09)",
        boxShadow: selected
          ? "0 30px 80px -28px rgba(0,0,0,0.82), 0 0 36px -12px rgba(143,29,44,0.48)"
          : "0 24px 64px -34px rgba(0,0,0,0.75)",
      }}
    >
      <div
        style={{
          fontFamily: theme.fonts.sans,
          fontSize: 16,
          textTransform: "uppercase",
          letterSpacing: 4,
          color: theme.colors.velvetSoft,
          marginBottom: 10,
        }}
      >
        {feature.eyebrow}
      </div>
      <div
        style={{
          fontFamily: theme.fonts.display,
          fontSize: 32,
          lineHeight: 1.02,
          color: theme.colors.ivory,
          marginBottom: 8,
        }}
      >
        {feature.title}
      </div>
      <div
        style={{
          fontFamily: theme.fonts.sans,
          fontSize: 16,
          lineHeight: 1.45,
          color: theme.colors.ash,
        }}
      >
        {feature.copy}
      </div>
    </GlassPanel>
  );
}

function AppShell({ frame }: { frame: number }) {
  const tab = Math.floor(interpolate(frame, [165, 610], [0, 4], clamp));
  const rows = ["The Velvet Room", "Founders Table", "Solana Highline"];
  return (
    <GlassPanel
      style={{
        position: "absolute",
        right: 120,
        top: 150,
        width: 820,
        height: 610,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 72,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          padding: "0 28px",
          justifyContent: "space-between",
        }}
      >
        <BrandMark small />
        <div
          style={{
            border: "1px solid rgba(143,29,44,0.35)",
            borderRadius: 999,
            padding: "10px 16px",
            color: theme.colors.velvetSoft,
            fontFamily: theme.fonts.mono,
            fontSize: 18,
          }}
        >
          12.480 SOL
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "210px 1fr", height: "calc(100% - 72px)" }}>
        <div
          style={{
            borderRight: "1px solid rgba(255,255,255,0.08)",
            padding: 24,
            fontFamily: theme.fonts.sans,
            color: theme.colors.ash,
            fontSize: 20,
          }}
        >
          {["Lobby", "Host a table", "Cashier", "History", "Account"].map((item, i) => (
            <div
              key={item}
              style={{
                padding: "14px 16px",
                marginBottom: 8,
                borderRadius: 12,
                background: i === tab ? "rgba(255,255,255,0.08)" : "transparent",
                color: i === tab ? theme.colors.ivory : theme.colors.ash,
              }}
            >
              {item}
            </div>
          ))}
        </div>
        <div style={{ padding: 30 }}>
          <div
            style={{
              fontFamily: theme.fonts.display,
              fontSize: 54,
              color: theme.colors.ivory,
              lineHeight: 1,
              marginBottom: 18,
            }}
          >
            {tab === 0 && "The best games are private"}
            {tab === 1 && "Configure your table"}
            {tab === 2 && "Cashier and settlement"}
            {tab === 3 && "Hand and ledger history"}
            {tab >= 4 && "Risk-aware controls"}
          </div>
          <div style={{ display: "grid", gap: 14 }}>
            {rows.map((row, i) => (
              <div
                key={row}
                style={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 14,
                  padding: 18,
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 18,
                  alignItems: "center",
                  background: "rgba(12,13,16,0.48)",
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: theme.fonts.sans,
                      fontSize: 22,
                      color: theme.colors.ivory,
                      marginBottom: 6,
                    }}
                  >
                    {tab === 2 ? ["Deposit credited", "Withdrawal review", "Reconciliation ok"][i] : row}
                  </div>
                  <div
                    style={{
                      fontFamily: theme.fonts.mono,
                      fontSize: 15,
                      color: theme.colors.ash,
                    }}
                  >
                    {tab === 3
                      ? "commit hash -> seed reveal -> deck proof"
                      : tab >= 4
                        ? "admin action logged and reviewed"
                        : "6 max / 0.25 SOL / invite code enabled"}
                  </div>
                </div>
                <div
                  style={{
                    borderRadius: 999,
                    border: "1px solid rgba(143,29,44,0.38)",
                    padding: "8px 12px",
                    color: theme.colors.velvetSoft,
                    fontFamily: theme.fonts.mono,
                    fontSize: 14,
                  }}
                >
                  {tab >= 3 ? "VERIFIED" : "JOIN"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}

function PokerTable({ frame }: { frame: number }) {
  const action = interpolate(frame, [330, 500], [0, 1], clamp);
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        top: 540,
        width: 620,
        height: 300,
        transform: `translateY(${interpolate(action, [0, 1], [50, 0])}px)`,
        opacity: interpolate(action, [0, 0.2], [0, 1], clamp),
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background:
            "radial-gradient(ellipse at center, #1b4d3a 0%, #12382b 55%, #0c2820 100%)",
          border: "18px solid rgba(22,24,28,0.95)",
          boxShadow: "0 35px 90px rgba(0,0,0,0.72), inset 0 0 0 1px rgba(255,255,255,0.08)",
        }}
      />
      {["YOU", "ALICE", "BOB", "HOST"].map((name, i) => {
        const angle = (-160 + i * 105) * (Math.PI / 180);
        const x = 300 + Math.cos(angle) * 265;
        const y = 145 + Math.sin(angle) * 120;
        return (
          <div
            key={name}
            style={{
              position: "absolute",
              left: x,
              top: y,
              transform: "translate(-50%, -50%)",
              borderRadius: 16,
              border: i === 0 ? "1px solid rgba(143,29,44,0.65)" : "1px solid rgba(255,255,255,0.1)",
              background: "rgba(12,13,16,0.82)",
              padding: "10px 14px",
              fontFamily: theme.fonts.mono,
              color: i === 0 ? theme.colors.velvetSoft : theme.colors.ivory,
              fontSize: 14,
            }}
          >
            {name}
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          display: "flex",
          gap: 10,
        }}
      >
        {["A", "K", "Q"].map((rank, i) => (
          <div
            key={rank}
            style={{
              width: 58,
              height: 82,
              borderRadius: 8,
              background: "#f4f1e8",
              display: "grid",
              placeItems: "center",
              color: theme.colors.charcoal900,
              fontFamily: theme.fonts.display,
              fontSize: 30,
              fontWeight: 700,
              transform: `translateY(${interpolate(action, [0, 1], [25, 0]) * (i + 1) * 0.2}px)`,
            }}
          >
            {rank}
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineRail({ frame }: { frame: number }) {
  const progress = interpolate(frame, [0, 780], [0, 1], clamp);
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        right: 120,
        bottom: 74,
        height: 2,
        background: "rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          width: `${progress * 100}%`,
          height: "100%",
          background: `linear-gradient(90deg, ${theme.colors.velvetDim}, ${theme.colors.velvetSoft})`,
        }}
      />
    </div>
  );
}

export const VelvetPlatformPromo = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const activeFeature = interpolate(frame, [150, 650], [0, features.length - 1], clamp);
  const heroOut = interpolate(frame, [112, 152], [1, 0], clamp);
  const platformIn = ease(frame, 156, 48);
  const closeIn = ease(frame, 650, 60);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.charcoal900,
        color: theme.colors.ivory,
        fontFamily: theme.fonts.sans,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: [
            "radial-gradient(60rem 60rem at 80% -10%, rgba(143,29,44,0.14), transparent 60%)",
            "radial-gradient(50rem 50rem at -10% 110%, rgba(18,56,43,0.38), transparent 60%)",
            "linear-gradient(180deg, #16181c 0%, #0c0d10 100%)",
          ].join(","),
        }}
      />
      <Img
        src={staticFile("banner.png")}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.06,
          filter: "saturate(0.85) contrast(1.1)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 112,
          top: 78,
          opacity: 1 - closeIn * 0.35,
        }}
      >
        <BrandMark small />
      </div>

      <div
        style={{
          position: "absolute",
          left: 120,
          top: 216,
          width: 790,
          opacity: heroOut,
          transform: `translateY(${interpolate(heroOut, [0, 1], [24, 0])}px)`,
        }}
      >
        <div
          style={{
            fontFamily: theme.fonts.sans,
            fontSize: 18,
            textTransform: "uppercase",
            letterSpacing: 6,
            color: theme.colors.velvetSoft,
            marginBottom: 22,
          }}
        >
          Private cardroom / Solana
        </div>
        <div
          style={{
            fontFamily: theme.fonts.display,
            fontSize: 116,
            lineHeight: 0.9,
            color: theme.colors.ivory,
            letterSpacing: 0,
          }}
        >
          Poker for the few who play it right.
        </div>
        <div
          style={{
            marginTop: 28,
            width: 590,
            color: theme.colors.ash,
            fontSize: 28,
            lineHeight: 1.42,
          }}
        >
          Real-money tables, Solana settlement, verifiable hands, and a ledger-first operating core.
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 250,
          top: 290,
          width: 620,
          height: 330,
          opacity: heroOut,
          transform: `scale(${interpolate(heroOut, [0, 1], [0.9, 1])})`,
        }}
      >
        {cards.map((rank, index) => (
          <Card key={rank} rank={rank} index={index} frame={frame} />
        ))}
      </div>

      <div
        style={{
          opacity: platformIn * (1 - closeIn * 0.85),
          transform: `translateY(${interpolate(platformIn, [0, 1], [46, 0])}px)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 120,
            top: 150,
            width: 620,
            display: "grid",
            gap: 10,
          }}
        >
          {features.map((feature, index) => (
            <FeatureCard
              key={feature.title}
              feature={feature}
              index={index}
              active={activeFeature}
            />
          ))}
        </div>
        <AppShell frame={frame} />
        <PokerTable frame={frame} />
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: closeIn,
          display: "grid",
          placeItems: "center",
          textAlign: "center",
          transform: `scale(${interpolate(closeIn, [0, 1], [0.97, 1])})`,
        }}
      >
        <div>
          <BrandMark />
          <div
            style={{
              marginTop: 42,
              fontFamily: theme.fonts.display,
              fontSize: 98,
              lineHeight: 0.96,
              maxWidth: 1120,
            }}
          >
            Private tables. Transparent money. Verifiable play.
          </div>
          <div
            style={{
              margin: "34px auto 0",
              maxWidth: 900,
              color: theme.colors.ash,
              fontSize: 30,
              lineHeight: 1.42,
            }}
          >
            Velvet Poker brings poker, Solana settlement, and operational controls into one restrained product surface.
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 120,
          bottom: 92,
          fontFamily: theme.fonts.mono,
          color: theme.colors.ashDim,
          fontSize: 16,
        }}
      >
        {Math.floor(frame / fps)}s / 27s
      </div>
      <TimelineRail frame={frame} />
    </AbsoluteFill>
  );
};
