import streamlit as st
import pandas as pd
import plotly.graph_objects as go

st.set_page_config(page_title="EV vs Mercedes + QDVE", layout="wide")
st.title("🚗 Comparador EV vs Mercedes com QDVE (Portugal)")
st.markdown("**Simulação 10 anos – breakeven exato + gráfico interativo**")

# ====================== DADOS BASE (podes editar aqui ou no UI) ======================
cars_data = {
    "Mercedes C-Class (Baseline)": {
        "running_costs": [4522 * (1.02 ** i) for i in range(10)],
        "fuel_costs": [1800 * (1.04 ** i) for i in range(10)],   # inflação energia
        "other_costs": [2722 * (1.02 ** i) for i in range(10)],
        "residuals": [35000 - i * 2200 for i in range(10)],
        "annual_loan_pmt": 0,
        "initial_withdrawal": 0,
    },
    "Tesla Model Y": {
        "running_costs": [1690 * (1.02 ** i) for i in range(10)],
        "fuel_costs": [0] * 10,
        "other_costs": [1690 * (1.02 ** i) for i in range(10)],
        "residuals": [52000 - i * 2800 for i in range(10)],
        "annual_loan_pmt": 3800,
        "initial_withdrawal": 8000,
    },
    "VW ID.3": {
        "running_costs": [1750 * (1.02 ** i) for i in range(10)],
        "fuel_costs": [0] * 10,
        "other_costs": [1750 * (1.02 ** i) for i in range(10)],
        "residuals": [42000 - i * 2600 for i in range(10)],
        "annual_loan_pmt": 3600,
        "initial_withdrawal": 6000,
    },
    "Hyundai Ioniq 5": {
        "running_costs": [1720 * (1.02 ** i) for i in range(10)],
        "fuel_costs": [0] * 10,
        "other_costs": [1720 * (1.02 ** i) for i in range(10)],
        "residuals": [48000 - i * 2700 for i in range(10)],
        "annual_loan_pmt": 3700,
        "initial_withdrawal": 7000,
    },
}

# ====================== SIDEBAR – INPUTS ======================
st.sidebar.header("Parâmetros")

selected_cars = st.sidebar.multiselect(
    "Escolhe os carros a comparar (podes escolher vários)",
    options=list(cars_data.keys()),
    default=["Tesla Model Y", "VW ID.3", "Hyundai Ioniq 5"]
)

years = st.sidebar.slider("Anos de simulação", 5, 15, 10)

# Investimento
inv_type = st.sidebar.selectbox("Tipo de investimento", ["QDVE (default)", "Outro"])
if inv_type == "QDVE":
    use_conservative = st.sidebar.checkbox("Usar retorno conservador 12% (em vez do histórico ~18%)", value=True)
    qdve_rate = 0.12 if use_conservative else 0.18
else:
    qdve_rate = st.sidebar.number_input("Retorno anual esperado (%)", value=12.0) / 100

apply_cgt = st.sidebar.checkbox("Aplicar CGT 28% no final (realista)", value=True)
cgt_rate = 0.28

# Sensibilidades
st.sidebar.subheader("Sensibilidades (Mercedes)")
r_base_adj = st.sidebar.slider("R_base Mercedes (%)", 70, 130, 100) / 100
fuel_adj = st.sidebar.slider("Preço combustível Mercedes (%)", 70, 130, 100) / 100

# ====================== SIMULAÇÃO ======================
def simulate_car(car_name, car, baseline, qdve_rate, apply_cgt, cgt_rate, r_base_adj, fuel_adj, years):
    mer_running = baseline["running_costs"]
    mer_fuel = baseline["fuel_costs"]
    mer_other = baseline["other_costs"]

    # Aplicar sensibilidades só na baseline
    adj_fuel = [f * fuel_adj for f in mer_fuel]
    adj_other = [o * (r_base_adj if r_base_adj != 1.0 else 1.0) for o in mer_other]  # R_base total ajustado
    adj_mer_running = [adj_fuel[i] + adj_other[i] for i in range(years)]

    qdve = -car["initial_withdrawal"]
    portfolio = [qdve]
    nw_delta = []
    residual_delta_series = []

    for t in range(years):
        savings = adj_mer_running[t] - car["running_costs"][t]
        net_cf = savings - car["annual_loan_pmt"]

        # Shortfall sai do QDVE
        qdve += net_cf
        qdve *= (1 + qdve_rate)
        portfolio.append(qdve)

        res_delta = car["residuals"][t] - baseline["residuals"][t]
        residual_delta_series.append(res_delta)

        # NW total = portfólio + residual atual (não acumulado!)
        total_nw = qdve + res_delta
        nw_delta.append(total_nw)

    # CGT só no final (ano 10 ou último ano)
    final_portfolio = portfolio[-1]
    if apply_cgt and final_portfolio > 0:
        gain = final_portfolio - car["initial_withdrawal"]  # ganho líquido investido
        cgt_amount = max(0, gain) * cgt_rate
        final_portfolio -= cgt_amount
        nw_delta[-1] = final_portfolio + residual_delta_series[-1]

    df = pd.DataFrame({
        "Ano": list(range(1, years + 1)),
        "NW Delta (€)": [round(x, 0) for x in nw_delta],
        "Portfólio QDVE (€)": [round(p, 0) for p in portfolio[1:]],
        "Residual Delta (€)": [round(r, 0) for r in residual_delta_series]
    })
    df["Breakeven"] = df["NW Delta (€)"] >= 0

    breakeven_year = df[df["Breakeven"]].index.min() + 1 if any(df["Breakeven"]) else None
    return df, breakeven_year, nw_delta[-1]

# ====================== EXECUÇÃO ======================
if st.button("🚀 Gerar Simulação", type="primary"):
    baseline = cars_data["Mercedes C-Class (Baseline)"]
    results = {}

    for car_name in selected_cars:
        if car_name == "Mercedes C-Class (Baseline)":
            continue
        car = cars_data[car_name]
        df, breakeven, final_delta = simulate_car(
            car_name, car, baseline, qdve_rate, apply_cgt, cgt_rate,
            r_base_adj, fuel_adj, years
        )
        results[car_name] = {"df": df, "breakeven": breakeven, "final_delta": final_delta}

    # Gráfico
    fig = go.Figure()
    for car_name, data in results.items():
        fig.add_trace(go.Scatter(
            x=data["df"]["Ano"],
            y=data["df"]["NW Delta (€)"],
            name=car_name,
            mode="lines+markers"
        ))
    fig.update_layout(
        title="Diferença de Património Líquido vs Mercedes (com QDVE)",
        xaxis_title="Ano",
        yaxis_title="Vantagem (€)",
        hovermode="x unified",
        height=600
    )
    st.plotly_chart(fig, use_container_width=True)

    # Tabela resumo
    summary = []
    for car_name, data in results.items():
        summary.append({
            "Carro": car_name,
            "Breakeven (ano)": data["breakeven"] or "Nunca (10 anos)",
            "Vantagem 10 anos (€)": round(data["final_delta"], 0)
        })
    st.dataframe(pd.DataFrame(summary), use_container_width=True)

    # Download
    combined = pd.concat([v["df"].assign(Carro=k) for k, v in results.items()])
    st.download_button("📥 Download CSV completo", combined.to_csv(index=False), "simulacao_ev_mercedes.csv")
