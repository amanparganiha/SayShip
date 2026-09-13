import { Redirect, Route, Switch } from "wouter";
import { ErrorText, FullScreenSpinner } from "./components/ui";
import { errorMessage } from "./lib/api";
import { useMe } from "./lib/queries";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Workspace from "./pages/Workspace";

export default function App() {
  const me = useMe();

  if (me.isPending) return <FullScreenSpinner />;
  if (me.isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <ErrorText>Can't reach the SayShip API: {errorMessage(me.error)}</ErrorText>
      </div>
    );
  }

  const signedIn = me.data.user !== null;
  return (
    <Switch>
      <Route path="/login">{signedIn ? <Redirect to="/" replace /> : <Login />}</Route>
      <Route path="/">{signedIn ? <Dashboard /> : <Redirect to="/login" replace />}</Route>
      <Route path="/projects/:id">
        {(params) =>
          signedIn ? <Workspace key={params.id} projectId={Number(params.id)} /> : <Redirect to="/login" replace />
        }
      </Route>
      <Route>
        <Redirect to="/" replace />
      </Route>
    </Switch>
  );
}
