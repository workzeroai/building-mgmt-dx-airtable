// n8n Code 노드 "오류 행 만들기" (Run Once for All Items)
// "결과 요약"의 errors(건너뜀·실패, 최대 20건)를 자동화 오류 테이블에 쓸 항목으로 펼친다. 없으면 0건 → 다음 노드가 돌지 않는다.
const { errors } = $input.first().json;
return (errors || []).map((fields) => ({ json: { body: { records: [{ fields }], typecast: true } } }));
