import { Component, type ReactNode } from "react";

interface Props {
  /** Changing this value clears a previous failure, for example when another tool opens. */
  resetKey: string;
  /** Receives no error details, so document text in exception messages never reaches the UI or logs. */
  onError: () => void;
  children: ReactNode;
}

interface State {
  failedKey: string | null;
}

/**
 * Contains render and effect failures inside tool panels so one failing tool closes
 * instead of unmounting the whole workspace and its open document.
 */
export class ToolErrorBoundary extends Component<Props, State> {
  state: State = { failedKey: null };

  static getDerivedStateFromError(): Partial<State> {
    return { failedKey: "" };
  }

  componentDidCatch() {
    this.setState({ failedKey: this.props.resetKey });
    this.props.onError();
  }

  componentDidUpdate(previous: Props) {
    if (
      this.state.failedKey !== null &&
      previous.resetKey !== this.props.resetKey
    ) {
      this.setState({ failedKey: null });
    }
  }

  render() {
    return this.state.failedKey === null ? this.props.children : null;
  }
}
