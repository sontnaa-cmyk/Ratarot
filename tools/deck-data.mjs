// 78 lá Tarot theo cấu trúc Rider–Waite–Smith. Nội dung diễn giải do dự án tự viết, mang tính giải trí & chiêm nghiệm.
// major: [vn, en, từ khóa, thông điệp]
export const MAJORS = [
  ['Kẻ Khờ', 'The Fool', 'khởi đầu · tự do · liều lĩnh trong sáng', 'Một hành trình mới đang gọi tên bạn; hãy bước đi với trái tim nhẹ như bụi sao.'],
  ['Nhà Ảo Thuật', 'The Magician', 'ý chí · sáng tạo · hành động', 'Bạn đã có đủ công cụ trong tay; hãy biến ý định thành hiện thực.'],
  ['Nữ Tư Tế', 'The High Priestess', 'trực giác · bí ẩn · tĩnh lặng', 'Câu trả lời nằm sẵn bên trong; hãy lắng nghe tiếng thì thầm của trăng.'],
  ['Nữ Hoàng', 'The Empress', 'nuôi dưỡng · dồi dào · sáng tạo', 'Sự trù phú đang nở rộ; hãy chăm sóc điều bạn yêu thương.'],
  ['Hoàng Đế', 'The Emperor', 'cấu trúc · quyền lực · kỷ luật', 'Hãy xây nền móng vững chắc và giữ lời hứa với chính mình.'],
  ['Giáo Hoàng', 'The Hierophant', 'truyền thống · học hỏi · niềm tin', 'Hãy tìm một người thầy hoặc một nguyên tắc để dẫn đường.'],
  ['Cặp Đôi', 'The Lovers', 'tình yêu · lựa chọn · hòa hợp', 'Một lựa chọn đến từ trái tim; hãy chọn điều đúng với giá trị của bạn.'],
  ['Cỗ Xe', 'The Chariot', 'ý chí · chiến thắng · tiến lên', 'Điều khiển hai lực đối nghịch bằng ý chí; chiến thắng đang đến gần.'],
  ['Sức Mạnh', 'Strength', 'can đảm · kiên nhẫn · lòng nhân', 'Sức mạnh thật sự là sự dịu dàng bền bỉ.'],
  ['Ẩn Sĩ', 'The Hermit', 'nội tâm · tìm kiếm · thông thái', 'Hãy dành thời gian cho riêng mình; ngọn đèn trong bạn đủ soi đường.'],
  ['Bánh Xe Vận Mệnh', 'Wheel of Fortune', 'chu kỳ · vận may · thay đổi', 'Bánh xe đang quay; một chuyển biến thuận lợi sắp tới.'],
  ['Công Lý', 'Justice', 'công bằng · sự thật · nhân quả', 'Sự thật đang sáng tỏ; hãy hành động ngay thẳng.'],
  ['Người Treo Ngược', 'The Hanged Man', 'buông bỏ · góc nhìn mới · chờ đợi', 'Hãy dừng lại và nhìn mọi thứ từ phía ngược lại.'],
  ['Cái Chết', 'Death', 'kết thúc · chuyển hóa · tái sinh', 'Không phải điều đáng sợ: một chương khép lại để chương mới mở ra.'],
  ['Điều Độ', 'Temperance', 'cân bằng · hòa hợp · kiên nhẫn', 'Hãy pha trộn từng chút một; trung đạo là con đường đẹp nhất.'],
  ['Ác Quỷ', 'The Devil', 'ràng buộc · cám dỗ · vật chất', 'Hãy nhìn xem điều gì đang trói bạn; xiềng xích thường lỏng hơn bạn nghĩ.'],
  ['Tòa Tháp', 'The Tower', 'đổ vỡ · bừng tỉnh · giải phóng', 'Cấu trúc giả tạo sụp đổ để chân lý hiện ra.'],
  ['Ngôi Sao', 'The Star', 'hy vọng · chữa lành · cảm hứng', 'Sau bão là bầu trời đầy sao; hãy tin vào ước mơ của bạn.'],
  ['Mặt Trăng', 'The Moon', 'ảo ảnh · tiềm thức · nỗi sợ', 'Mọi thứ chưa rõ ràng; hãy đi chậm và tin vào trực giác.'],
  ['Mặt Trời', 'The Sun', 'niềm vui · thành công · sức sống', 'Ánh sáng của thần Ra chiếu rọi; niềm vui và thành công đang tới.'],
  ['Phán Xét', 'Judgement', 'thức tỉnh · tha thứ · tiếng gọi', 'Tiếng gọi thức tỉnh vang lên; hãy tha thứ và bước lên phiên bản mới.'],
  ['Thế Giới', 'The World', 'trọn vẹn · hoàn thành · du hành', 'Một vòng tròn khép lại viên mãn; bạn sẵn sàng cho chu kỳ mới.'],
];
export const ROMAN = ['0','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI'];

export const SUITS = {
  wands:     { vn: 'Gậy',   en: 'Wands',     element: 'Lửa',  domain: 'hành động · đam mê · sự nghiệp' },
  cups:      { vn: 'Cốc',   en: 'Cups',      element: 'Nước', domain: 'cảm xúc · tình yêu · trực giác' },
  swords:    { vn: 'Kiếm',  en: 'Swords',    element: 'Khí',  domain: 'tư duy · quyết định · thử thách' },
  pentacles: { vn: 'Tiền',  en: 'Pentacles', element: 'Đất',  domain: 'tiền bạc · công việc · sức khỏe' },
};
export const RANKS = ['Ace','2','3','4','5','6','7','8','9','10','Page','Knight','Queen','King'];
export const RANK_VN = ['Át','Hai','Ba','Bốn','Năm','Sáu','Bảy','Tám','Chín','Mười','Thị Đồng','Kỵ Sĩ','Hoàng Hậu','Quốc Vương'];

// minor[suit] = 14 mục: [từ khóa, thông điệp]
export const MINORS = {
  wands: [
    ['tia lửa khởi đầu', 'Một nguồn cảm hứng mới vừa bùng lên; hãy bắt tay vào điều bạn ấp ủ.'],
    ['lập kế hoạch', 'Bạn đứng giữa hai hướng đi; hãy nhìn xa trước khi bước.'],
    ['mở rộng', 'Thuyền đã ra khơi, kết quả đầu tiên sắp về; kiên nhẫn chờ gió.'],
    ['ăn mừng', 'Một cột mốc đáng vui; hãy dừng lại tận hưởng cùng người thân.'],
    ['cạnh tranh', 'Nhiều ý kiến va chạm; xem đó là sự rèn luyện chứ không phải chiến tranh.'],
    ['chiến thắng', 'Sự công nhận đang đến; hãy khiêm tốn và biết ơn.'],
    ['giữ lập trường', 'Bạn đang ở thế đúng; đừng lùi bước trước áp lực.'],
    ['tốc độ', 'Mọi việc chuyển động rất nhanh; tin nhắn và tin vui sắp đến.'],
    ['kiên cường', 'Bạn mệt nhưng đã gần tới đích; thêm một chút bền bỉ nữa thôi.'],
    ['gánh nặng', 'Bạn ôm quá nhiều việc; hãy học cách chia sẻ và buông bớt.'],
    ['người tìm tòi', 'Một ý tưởng hoặc tin tức mới đầy hứng khởi; hãy tò mò và thử.'],
    ['dấn thân', 'Năng lượng mạnh và nhiệt huyết; cẩn thận đừng vội vàng.'],
    ['tỏa sáng', 'Sự tự tin ấm áp; hãy làm điều khiến bạn rạng rỡ.'],
    ['người dẫn đường', 'Tầm nhìn và bản lĩnh lãnh đạo; hãy biến ý tưởng thành đại cuộc.'],
  ],
  cups: [
    ['trái tim đầy', 'Tình cảm mới hoặc niềm vui tràn đầy đang chảy tới bạn.'],
    ['kết nối', 'Một sự hòa hợp giữa hai người; mối quan hệ đang tốt đẹp lên.'],
    ['tiệc vui', 'Bạn bè và niềm vui chung; hãy ăn mừng cùng nhau.'],
    ['chán nản', 'Bạn mải nhìn điều đã có mà quên món quà mới đang được trao.'],
    ['tiếc nuối', 'Đừng chỉ nhìn ly đổ; vẫn còn hai ly đầy phía sau bạn.'],
    ['hoài niệm', 'Một kỷ niệm đẹp hoặc người cũ quay về; sự ngây thơ chữa lành.'],
    ['ảo mộng', 'Nhiều lựa chọn lung linh; hãy tỉnh táo phân biệt thực và ảo.'],
    ['rời đi', 'Đã đến lúc bỏ lại điều không còn nuôi dưỡng bạn để tìm ý nghĩa sâu hơn.'],
    ['điều ước thành', 'Sự mãn nguyện; điều bạn mong đang ở rất gần.'],
    ['hạnh phúc trọn vẹn', 'Gia đình, bình yên và lòng biết ơn; cầu vồng sau cơn mưa.'],
    ['thông điệp trái tim', 'Một tin vui cảm xúc hoặc lời mời dịu dàng; hãy lắng nghe trực giác.'],
    ['chàng thơ', 'Một lời tỏ bày đến từ trái tim; đừng quá mộng mơ.'],
    ['trực giác', 'Sự thấu cảm sâu sắc; hãy chăm sóc cảm xúc của chính bạn trước.'],
    ['điềm tĩnh', 'Cảm xúc cân bằng; bạn đủ trưởng thành để dẫn dắt bằng sự dịu dàng.'],
  ],
  swords: [
    ['chân lý', 'Một ý nghĩ sáng rõ cắt qua màn sương; hãy nói sự thật bằng sự tử tế.'],
    ['bế tắc', 'Bạn đang lảng tránh một quyết định; hãy mở mắt để thấy lựa chọn.'],
    ['trái tim đau', 'Nỗi buồn là có thật; hãy cho phép mình khóc để lành lại.'],
    ['nghỉ ngơi', 'Bạn cần dừng lại để hồi phục; nạp lại năng lượng trước khi tiếp tục.'],
    ['thắng thua', 'Cẩn thận với chiến thắng đắng; hãy chọn hòa khí thay vì cái tôi.'],
    ['vượt qua', 'Bạn đang rời vùng sóng gió sang bờ yên; đây là hành trình chữa lành.'],
    ['mưu lược', 'Cẩn trọng với sự thiếu thật thà; hãy đi đường khôn ngoan và minh bạch.'],
    ['tự trói buộc', 'Nút thắt nằm trong suy nghĩ; bạn tự do hơn bạn tưởng.'],
    ['lo âu đêm khuya', 'Nỗi sợ thường lớn hơn thực tế; hãy tìm một người để sẻ chia.'],
    ['chạm đáy', 'Một chương đã khép; bình minh luôn theo sau đêm tối nhất.'],
    ['tò mò trí tuệ', 'Tin tức hoặc ý tưởng mới đang đến; hãy đặt những câu hỏi hay.'],
    ['lao tới', 'Quyết đoán và nhanh nhạy; hãy nghĩ kỹ lời nói trước khi nói.'],
    ['minh mẫn', 'Sáng suốt và thẳng thắn; ranh giới rõ ràng giúp bạn mạnh mẽ.'],
    ['trí tuệ', 'Công bằng và logic; hãy quyết định bằng cả lý trí lẫn lương tâm.'],
  ],
  pentacles: [
    ['hạt giống', 'Một cơ hội tài chính hoặc công việc mới đang mở; hãy gieo hạt từ hôm nay.'],
    ['cân bằng', 'Bạn đang xoay xở nhiều việc; hãy linh hoạt và giữ nhịp.'],
    ['hợp tác', 'Tay nghề được ghi nhận; làm việc nhóm mang lại kết quả tốt.'],
    ['giữ chặt', 'Tiết kiệm là tốt, nhưng đừng nắm chặt đến mức nghẹt thở.'],
    ['khó khăn', 'Một giai đoạn thiếu thốn; đừng ngại nhờ giúp đỡ, ánh sáng vẫn ở cửa sổ.'],
    ['cho và nhận', 'Sự hào phóng được đền đáp; chia sẻ sẽ mang quý nhân đến.'],
    ['chờ mùa', 'Bạn đã gieo hạt; hãy kiên nhẫn chờ và đánh giá tiến độ.'],
    ['rèn nghề', 'Chăm chỉ và tập trung; tay nghề của bạn sắp thành.'],
    ['tự lập', 'Thành quả của riêng bạn, thanh lịch và an yên; hãy tận hưởng điều mình đã xây.'],
    ['di sản', 'Sự vững bền, gia đình và nền tảng lâu dài.'],
    ['học hỏi', 'Một cơ hội học nghề hoặc tin tốt về tiền bạc; hãy bắt đầu từ bước nhỏ.'],
    ['bền bỉ', 'Chậm mà chắc; đáng tin cậy nhưng đừng quá cứng nhắc.'],
    ['nuôi dưỡng', 'Ấm áp và thực tế; hãy chăm sóc tổ ấm và cả bản thân.'],
    ['thịnh vượng', 'Ổn định và thành đạt; hãy dùng sự đủ đầy để nâng đỡ người khác.'],
  ],
};

export function buildDeck() {
  const cards = [];
  MAJORS.forEach(([vn, en, kw, msg], i) => {
    cards.push({ id: `major-${String(i).padStart(2, '0')}`, arcana: 'major', num: i, suit: null,
      vn, en, roman: ROMAN[i], keywords: kw, message: msg, element: 'Vũ trụ' });
  });
  for (const suit of Object.keys(SUITS)) {
    const S = SUITS[suit];
    RANKS.forEach((r, i) => {
      const [kw, msg] = MINORS[suit][i];
      cards.push({ id: `${suit}-${String(i + 1).padStart(2, '0')}`, arcana: 'minor', num: i + 1, suit,
        vn: `${RANK_VN[i]} ${S.vn}`, en: `${r} of ${S.en}`, roman: i < 10 ? (i === 0 ? 'A' : String(i + 1)) : ['Pg', 'Kn', 'Q', 'K'][i - 10],
        keywords: kw, message: msg, element: S.element });
    });
  }
  return cards;
}
