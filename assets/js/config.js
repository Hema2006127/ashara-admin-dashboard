/**
 * Ashara Project - Global Configuration & Sign Data Constants
 * مشروع عشرة - إعدادات النظام وثوابت لغة الإشارة العربية
 */

const AsharaConfig = {
    // Supabase Credentials
    SUPABASE_URL: "https://hbzmrurfkvpqsturuyow.supabase.co",
    SUPABASE_KEY: "sb_publishable_RQXz_J9lHVUyKEwU84hh6Q_bcVQ6RHh",

    // Collection Targets
    TARGET_PER_LETTER: 100,
    SAMPLES_PER_ROUND: 50,

    // 31 Arabic Sign Letters (مطابق لموديل الذكاء الاصطناعي app/config.py)
    LETTERS: [
        "ا", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص", "ض", "ط",
        "ظ", "ع", "غ", "ف", "ق", "ك", "ل", "م", "ن", "ه", "و", "ي", "ة", "ال", "لا"
    ],

    LETTER_NAMES: {
        "ا": "ألف ( أ / ا )", "ب": "باء ( ب )", "ت": "تاء ( ت )", "ث": "ثاء ( ث )",
        "ج": "جيم ( ج )", "ح": "حاء ( ح )", "خ": "خاء ( خ )", "د": "دال ( د )",
        "ذ": "ذال ( ذ )", "ر": "راء ( ر )", "ز": "زاي ( ز )", "س": "سين ( س )",
        "ش": "شين ( ش )", "ص": "صاد ( ص )", "ض": "ضاد ( ض )", "ط": "طاء ( ط )",
        "ظ": "ظاء ( ظ )", "ع": "عين ( ع )", "غ": "غين ( غ )", "ف": "فاء ( ف )",
        "ق": "قاف ( ق )", "ك": "كاف ( ك )", "ل": "لام ( ل )", "م": "ميم ( م )",
        "ن": "نون ( ن )", "ه": "هاء ( هـ )", "و": "واو ( و )", "ي": "ياء ( ي )",
        "ة": "تاء مربوطة ( ة )", "ال": "ألف ولام ( ال )", "لا": "لام ألف ( لا )"
    },

    LETTER_INFO: [
        { char: "ا", name: "حرف الألف ( أ / ا )", angle: "مواجهة أمامية مباشرة (0°)", hint: "إبهام مرفوع للأعلى وباقي الأصابع مضمومة", image: "assets/images/letters/0.png" },
        { char: "ب", name: "حرف الباء ( ب )", angle: "مواجهة أمامية مباشرة (0°)", hint: "سبابة مرفوعة وباقي الأصابع مضمومة تلمس الإبهام", image: "assets/images/letters/1.png" },
        { char: "ت", name: "حرف التاء ( ت )", angle: "مواجهة أمامية مباشرة (0°)", hint: "سبابة ووسطى مرفوعتان ومتقاربتان للأعلى", image: "assets/images/letters/2.png" },
        { char: "ث", name: "حرف الثاء ( ث )", angle: "مواجهة أمامية مباشرة (0°)", hint: "ثلاثة أصابع مرفوعة ومتقاربة (سبابة، وسطى، بنصر)", image: "assets/images/letters/3.png" },
        { char: "ج", name: "حرف الجيم ( ج )", angle: "زاوية جانبية (45°)", hint: "كف أفقي مع ثني الأصابع كقوس نصف دائري", image: "assets/images/letters/4.png" },
        { char: "ح", name: "حرف الحاء ( ح )", angle: "زاوية جانبية (45°)", hint: "أصابع مفرودة أفقياً متجهة للجانب بدون إبهام بارز", image: "assets/images/letters/5.png" },
        { char: "خ", name: "حرف الخاء ( خ )", angle: "زاوية جانبية (45°)", hint: "أصابع مفرودة أفقياً مع ثني خفيف يشبه حرف الحاء", image: "assets/images/letters/6.png" },
        { char: "د", name: "حرف الدال ( د )", angle: "زاوية جانبية (45°)", hint: "السبابة والإبهام متوازيان يشكلان زاوية حادة", image: "assets/images/letters/7.png" },
        { char: "ذ", name: "حرف الذال ( ذ )", angle: "زاوية جانبية (45°)", hint: "مثل الدال مع رفع خفيف لطرف السبابة", image: "assets/images/letters/8.png" },
        { char: "ر", name: "حرف الراء ( ر )", angle: "زاوية جانبية (45°)", hint: "سبابة مثنية كالقوس متجهة للأسفل بانسيابية", image: "assets/images/letters/9.png" },
        { char: "ز", name: "حرف الزاي ( ز )", angle: "زاوية جانبية (45°)", hint: "مثل الراء مع إبهام يلمس وسط السبابة", image: "assets/images/letters/10.png" },
        { char: "س", name: "حرف السين ( س )", angle: "مواجهة أمامية مباشرة (0°)", hint: "كف اليد مفرود للأعلى في مواجهة الكاميرا", image: "assets/images/letters/11.png" },
        { char: "ش", name: "حرف الشين ( ش )", angle: "مواجهة أمامية مباشرة (0°)", hint: "أصابع اليد الخمسة متباعدة ومفرودة بالكامل", image: "assets/images/letters/12.png" },
        { char: "ص", name: "حرف الصاد ( ص )", angle: "مواجهة أمامية مباشرة (0°)", hint: "قبضة اليد مضمومة بالكامل ومواجهة للأمام", image: "assets/images/letters/13.png" },
        { char: "ض", name: "حرف الضاد ( ض )", angle: "مواجهة أمامية مباشرة (0°)", hint: "قبضة مضمومة مع بروز الإبهام ممدوداً للجانب", image: "assets/images/letters/14.png" },
        { char: "ط", name: "حرف الطاء ( ط )", angle: "مواجهة أمامية مائلة (30°)", hint: "السبابة والإبهام يشكلان منقاراً متجهاً للأمام", image: "assets/images/letters/15.png" },
        { char: "ظ", name: "حرف الظاء ( ظ )", angle: "مواجهة أمامية مائلة (30°)", hint: "مثل الطاء مع رفع الوسطى كعلامة إضافية", image: "assets/images/letters/16.png" },
        { char: "ع", name: "حرف العين ( ع )", angle: "زاوية جانبية (45°)", hint: "سبابة ووسطى ممدودتان أفقياً للأمام", image: "assets/images/letters/17.png" },
        { char: "غ", name: "حرف الغين ( غ )", angle: "زاوية جانبية (45°)", hint: "مثل العين مع رفع الإبهام للأعلى", image: "assets/images/letters/18.png" },
        { char: "ف", name: "حرف الفاء ( ف )", angle: "مواجهة أمامية مباشرة (0°)", hint: "السبابة مثنية كحلقة تلامس طرف الإبهام", image: "assets/images/letters/19.png" },
        { char: "ق", name: "حرف القاف ( ق )", angle: "مواجهة أمامية مباشرة (0°)", hint: "سبابة وإبهام مفتوحان للأمام على شكل قوس", image: "assets/images/letters/20.png" },
        { char: "ك", name: "حرف الكاف ( ك )", angle: "زاوية جانبية (30°)", hint: "كف مفرود مائل قليلاً للجانب كحرف C", image: "assets/images/letters/21.png" },
        { char: "ل", name: "حرف اللام ( ل )", angle: "مواجهة أمامية مباشرة (0°)", hint: "زاوية قائمة حادة بين الإبهام والسبابة كحرف L", image: "assets/images/letters/22.png" },
        { char: "م", name: "حرف الميم ( م )", angle: "مواجهة أمامية متجهة للأسفل", hint: "قبضة متجهة للأسفل مع إشارة السبابة للأسفل", image: "assets/images/letters/23.png" },
        { char: "ن", name: "حرف النون ( ن )", angle: "مواجهة أمامية مباشرة (0°)", hint: "سبابة مثنية للأمام كالقوس متجهة للأسفل", image: "assets/images/letters/24.png" },
        { char: "ه", name: "حرف الهاء ( هـ )", angle: "مواجهة أمامية مباشرة (0°)", hint: "أطراف الأصابع الخمسة مجتمعة تلامس بعضها كالقمع", image: "assets/images/letters/25.png" },
        { char: "و", name: "حرف الواو ( و )", angle: "زاوية جانبية مائلة (45°)", hint: "قبضة مائلة متجهة للأسفل وللجانب", image: "assets/images/letters/26.png" },
        { char: "ي", name: "حرف الياء ( ي )", angle: "مواجهة أمامية مباشرة (0°)", hint: "خنصر مرفوع وإبهام ممدود للجانب (شكل الهاتف)", image: "assets/images/letters/27.png" },
        { char: "ة", name: "حرف التاء المربوطة ( ة )", angle: "مواجهة أمامية مباشرة (0°)", hint: "سبابة ووسطى متقاطعتان أو مثنيتان برفق", image: "assets/images/letters/28.png" },
        { char: "ال", name: "حرف الألف واللام ( ال )", angle: "مواجهة أمامية مباشرة (0°)", hint: "إشارة الألف تليها إشارة اللام بانسيابية", image: "assets/images/letters/29.png" },
        { char: "لا", name: "حرف اللام ألف ( لا )", angle: "مواجهة أمامية مباشرة (0°)", hint: "سبابة ووسطى مفرودتان متقاطعتان كعلامة X", image: "assets/images/letters/30.png" }
    ]
};

// Freeze object to prevent accidental runtime mutations
Object.freeze(AsharaConfig);
Object.freeze(AsharaConfig.LETTERS);
Object.freeze(AsharaConfig.LETTER_NAMES);
Object.freeze(AsharaConfig.LETTER_INFO);

window.AsharaConfig = AsharaConfig;
