import { Panel } from "../../components/Panel.tsx";
import { Segmented } from "../../components/Segmented.tsx";
import { useDashboard, type BottomTab } from "../../state/store.ts";
import { EmittersRanking } from "./EmittersRanking.tsx";
import { EnergyMixChart } from "./EnergyMixChart.tsx";
import { ForestLoss } from "./ForestLoss.tsx";
import { ProducersRanking } from "./ProducersRanking.tsx";
import { WorldByFuelChart } from "./WorldByFuelChart.tsx";
import "./industry.css";

const TABS: { value: BottomTab; label: string }[] = [
  { value: "emitters", label: "Who emits" },
  { value: "producers", label: "Producers" },
  { value: "fuels", label: "By fuel" },
  { value: "energy", label: "Energy mix" },
  { value: "forests", label: "Forests" },
];

/** "Who is causing it": countries, fuels, power systems and land. */
export function IndustryPanel() {
  const tab = useDashboard((s) => s.bottomTab);
  const setTab = useDashboard((s) => s.setBottomTab);
  return (
    <Panel
      title="Industry & land"
      actions={<Segmented label="Industry view" value={tab} options={TABS} onChange={setTab} />}
      className="industry-panel"
    >
      {tab === "emitters" && <EmittersRanking />}
      {tab === "producers" && <ProducersRanking />}
      {tab === "fuels" && <WorldByFuelChart />}
      {tab === "energy" && <EnergyMixChart />}
      {tab === "forests" && <ForestLoss />}
    </Panel>
  );
}
