import styles from './EntryPage.module.css'

export function EntryPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>REAL-TIME YACHT DICE</p>
        <h1>YORR</h1>
        <p>흔들거나 탭해서 함께 즐기는 모바일 요트다이스</p>
        <button type="button">게임 시작</button>
      </section>
    </main>
  )
}
