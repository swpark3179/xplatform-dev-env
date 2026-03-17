export type RefNodeType = 'method' | 'class' | 'query';

export interface RefNode {
    /** 고유 ID (순환참조 방지용, 형식: fsPath::symbolName) */
    id: string;
    /** 표시 레이블 (예: FooService#doSomething) */
    label: string;
    /** 노드 종류 */
    nodeType: RefNodeType;
    /** 파일 URI 문자열 (클릭 이동용) */
    uri?: string;
    /** 이동할 행 (0-based) */
    line?: number;
    /** 이동할 열 (0-based) */
    character?: number;
    /** 내가 참조하는 대상 (오른쪽, 아웃바운드) */
    outbound: RefNode[];
    /** 나를 참조하는 대상 (왼쪽, 인바운드) */
    inbound: RefNode[];
    /** 순환 참조로 잘린 경우 */
    isCyclic?: boolean;
    /** 선택된 루트 노드 여부 */
    isRoot?: boolean;
}

export interface RefGraphData {
    /** 선택한 노드 (중앙 루트) */
    root: RefNode;
    /** 시작점 표시 레이블 */
    startLabel: string;
    /** 경고 메시지 */
    warning?: string;
}
