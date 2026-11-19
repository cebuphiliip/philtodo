/* 필투두 동기화 설정(Supabase) — 필보드와 같은 계정으로 로그인한다.
   이 키는 공개용 키라 페이지에 넣어도 된다 — 할 일은 로그인한 본인 것만 읽고 쓸 수 있다(RLS). */
window.PT_CONFIG = {
  url: "https://ykobggucsqjdqknejuvc.supabase.co",
  key: "sb_publishable_GcGB2svxfKVri1HTkti05g_3xRkTesb",
  helper: "http://127.0.0.1:8790"   // PC 도우미(server.py) 주소 — 폴더 사진·HTML 열기
};

/* 사장님 비즈니스 — 맨 윗줄 칸. 사업이 늘면 여기에 한 줄씩 추가한다(id 는 영문, icon 은 app.js BIZ_ICON 의 이름).
   has = 이 사업에 속하는 할 일 biz 값(투윙스·솔타나 등은 모두 여행사). 두 번째 사업이 생기면 칸을 누를 때 has 로 나눠 보이게 한다. */
window.PT_BIZ = [
  { id: "travel", name: "여행사", icon: "plane", has: ["투윙스", "솔타나", "렌트카", "필립스투어", "공통"] }
];
