import { BaseEdge, type Edge, type EdgeProps, getBezierPath, getSmoothStepPath } from '@xyflow/react';
import { memo } from 'react';

export type BranchEdgeData = {
  color: string;
  /** Smooth curve (main branches of horizontal layouts) or rounded elbow. */
  curved: boolean;
  /** Main branches (leaving the root) are drawn thicker. */
  main: boolean;
};

export type BranchEdgeType = Edge<BranchEdgeData, 'branch'>;

function BranchEdgeComponent(props: EdgeProps<BranchEdgeType>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [path] = data?.curved
    ? getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.45 })
    : getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 10, offset: 12 });

  return (
    <BaseEdge
      id={props.id}
      path={path}
      style={{ stroke: data?.color ?? '#999', strokeWidth: data?.main ? 2.5 : 1.75, fill: 'none' }}
    />
  );
}

export const BranchEdge = memo(BranchEdgeComponent);
