import { useEffect, useRef, useState } from "react";
import { HStack, Text } from "@seed-design/react";

import type { MapEdge, MapEdgeKind } from "@device-farm/core/device/screen-map";

import { api, usePoll } from "./api-client";
import { Badge, type BadgeProps } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { useAppConfig } from "./app-context";
import { buildScreenTree, type ScreenNode } from "./screen-map-tree";
import "./screen-map.css";

/** 카드 안에 개수로만 보이는 간선(다른 화면으로 가지 않는 것) */
const leafKinds = ["popup", "dead", "error"] as const satisfies readonly MapEdgeKind[];
const kindLabels = { navigate: "이동", popup: "팝업", dead: "반응 없음", error: "에러" } as const satisfies Record<MapEdgeKind, string>;
const kindTones = { navigate: "informative", popup: "neutral", dead: "warning", error: "critical" } as const satisfies Record<MapEdgeKind, BadgeProps["tone"]>;
const roleLabels = { button: "버튼", link: "링크" } as const satisfies Record<MapEdge["role"], string>;
const screenNotes = { repeated: "위에서 펼침", unvisited: "아직 안 눌러 봄" } as const;

function leafEdges(node: ScreenNode): MapEdge[] {
  return node.edges.filter((item) => !item.child).map((item) => item.edge);
}

/** 화면 카드: 경로·제목·팝업/반응 없음/에러 개수. 누르면 그 버튼 목록을 펼친다. */
function ScreenCard({ node, title }: { node: ScreenNode; title?: string }) {
  const [open, setOpen] = useState(false);
  const leaves = leafEdges(node);
  const note = node.repeated ? screenNotes.repeated : node.unvisited ? screenNotes.unvisited : null;
  return (
    <div className={note ? "smap-card smap-card-muted" : "smap-card"}>
      <Text textStyle="t4Bold">{node.path}</Text>
      {title ? <Text textStyle="t3Regular" color="fg.neutralMuted">{title}</Text> : null}
      {note ? <Text textStyle="t2Regular" color="fg.neutralSubtle">{note}</Text> : null}
      {leaves.length > 0 ? (
        <button type="button" className="smap-leaf-toggle" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <HStack gap="x1" wrap="wrap">
            {leafKinds.map((kind) => {
              const count = leaves.filter((edge) => edge.kind === kind).length;
              return count > 0 ? (
                <Badge key={kind} tone={kindTones[kind]} variant="weak">
                  {`${kindLabels[kind]} ${count}`}
                </Badge>
              ) : null;
            })}
          </HStack>
        </button>
      ) : null}
      {open ? (
        <ul className="smap-leaves">
          {leaves.map((edge) => (
            <li key={`${edge.role}:${edge.name}`}>
              <Text textStyle="t2Regular">
                {`${kindLabels[edge.kind]} · ${roleLabels[edge.role]} 「${edge.name}」${edge.texts ? ` → ${edge.texts[0]}` : ""}${edge.message && edge.kind === "error" ? ` (${edge.message})` : ""}`}
              </Text>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** 화면 노드 하나와 그 아래로 내려가는 도착 화면들. 내려온 선 끝에 누른 버튼 이름을 적는다. */
function TreeNode({ node, title }: { node: ScreenNode; title?: string }) {
  const children = node.edges.filter((item) => item.child);
  return (
    <div className="smap-node">
      <ScreenCard node={node} title={title} />
      {children.length > 0 ? (
        <div className="smap-children">
          {children.map(({ edge, child }) => (
            <div key={`${edge.role}:${edge.name}`} className="smap-child">
              <span className="smap-label">
                <Text textStyle="t2Regular" color="fg.neutralMuted">{`${roleLabels[edge.role]} 「${edge.name}」`}</Text>
              </span>
              {child ? <TreeNode node={child} title={edge.texts?.[0]} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 루트 하나의 트리. 넓으면 가로로 스크롤하고, 처음에는 루트 카드가 보이게 가운데로 맞춘다. */
function TreeScroll({ root }: { root: ScreenNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, []);
  return (
    <div ref={ref} className="smap-tree">
      <TreeNode node={root} />
    </div>
  );
}

/** 버튼 눌러보기로 모은 화면 지도를 홈·탭 화면에서 아래로 내려가는 트리로 그린다. */
export function ScreenMapSection() {
  const { homePath } = useAppConfig();
  const map = usePoll(api.screenMap);
  const edges = map.data?.edges ?? [];
  const screenCount = new Set(edges.map((edge) => edge.from)).size;
  const roots = buildScreenTree(edges, homePath);

  return (
    <section className="baselines-card" aria-label="화면 지도">
      <Text as="h3" textStyle="t4Bold">
        {`화면 지도 · 화면 ${screenCount}개`}
      </Text>
      <Text textStyle="t3Regular" color="fg.neutralSubtle">
        「버튼 눌러보기」를 켜고 점검하면 모여요. 위 카드에서 내려온 선의 이름이 누른 버튼, 그 아래 카드가 도착 화면이에요. 카드의 팝업·반응 없음·에러를 누르면 그 버튼이 보여요.
      </Text>
      {map.error ? <Callout tone="critical" description={map.error} /> : null}
      {map.data && roots.length === 0 ? <Text color="fg.neutralMuted">아직 모은 화면이 없어요.</Text> : null}
      {roots.length > 0 ? (
        <div className="smap-trees">
          {roots.map((root) => (
            <TreeScroll key={root.path} root={root} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
