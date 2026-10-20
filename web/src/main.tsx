import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Redirect, Route, Switch } from 'wouter'
import { Layout } from './components/Layout.tsx'
import { Empty } from './components/ui.tsx'
import { LiveContext, useLiveConnection } from './lib/api.ts'
import { OverviewView } from './views/Overview.tsx'
import { RunsView } from './views/Runs.tsx'
import { SkillDetailView } from './views/SkillDetail.tsx'
import { SkillsView } from './views/Skills.tsx'
import { TraceView } from './views/Trace.tsx'
import './styles.css'

function App() {
  const live = useLiveConnection()
  return (
    <LiveContext value={live}>
      <Layout>
        <Switch>
          <Route path="/">
            <Redirect to="/overview" />
          </Route>
          <Route path="/overview" component={OverviewView} />
          <Route path="/skills" component={SkillsView} />
          <Route path="/skills/:id">{(p) => <SkillDetailView id={p.id} />}</Route>
          <Route path="/runs" component={RunsView} />
          <Route path="/runs/:id">{(p) => <TraceView id={p.id} />}</Route>
          <Route>
            <Empty title="Nothing here." />
          </Route>
        </Switch>
      </Layout>
    </LiveContext>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
