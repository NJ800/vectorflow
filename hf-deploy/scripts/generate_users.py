import random
import pandas as pd
from db import get_engine
from sqlalchemy import text

NUM_USERS = 500
random.seed(42)

# Skills grouped by domain, keyed by keywords we'll match against job titles.
# A user's skills are now drawn from the domain matching their assigned title,
# not a random flat pool -- this keeps profile_text internally consistent.
DOMAIN_SKILLS = {
    "healthcare": ["Patient Care", "Nursing", "Medical Records", "CPR Certified",
                   "Clinical Documentation", "HIPAA Compliance", "Case Management"],
    "tech": ["Python", "SQL", "JavaScript", "AWS", "Docker", "Kubernetes",
             "React", "Java", "Data Analysis", "Machine Learning"],
    "business_admin": ["Project Management", "Excel", "Communication",
                        "Financial Analysis", "Accounting", "Negotiation", "Salesforce"],
    "sales_marketing": ["Sales", "Marketing", "SEO", "Content Writing",
                         "Negotiation", "Public Speaking", "Customer Service"],
    "education": ["Teaching", "Curriculum Design", "Classroom Management", "Tutoring"],
    "logistics": ["Supply Chain", "Logistics", "Inventory Management", "Import Export"],
    "hr_recruiting": ["Recruiting", "HR Management", "Onboarding", "Employee Relations"],
    "engineering": ["AutoCAD", "Electrical Engineering", "Mechanical Engineering", "MATLAB"],
    "legal": ["Legal Research", "Contract Negotiation", "Compliance"],
    "general": ["Communication", "Leadership", "Customer Service", "Problem Solving"],
}

# Keyword -> domain mapping, checked against the job title (case-insensitive substring match)
DOMAIN_KEYWORDS = {
    "healthcare": ["nurse", "medical", "patient", "clinical", "health", "care", "counselor",
                   "residential", "therapist", "aide", "support"],
    "tech": ["engineer", "developer", "software", "data", "it ", "system", "admin",
             "technician", "hadoop", "cloud", "devops"],
    "business_admin": ["manager", "administrator", "analyst", "coordinator", "operations"],
    "sales_marketing": ["sales", "marketing", "account executive", "business development"],
    "education": ["teacher", "instructor", "tutor", "trainer", "education"],
    "logistics": ["supply chain", "logistics", "warehouse", "import", "export", "shipping"],
    "hr_recruiting": ["recruiter", "hr ", "human resources", "talent"],
    "engineering": ["mechanical", "electrical", "civil engineer", "cad"],
    "legal": ["legal", "attorney", "paralegal", "counsel"],
}

def infer_domain(title):
    title_lower = title.lower()
    for domain, keywords in DOMAIN_KEYWORDS.items():
        if any(kw in title_lower for kw in keywords):
            return domain
    return "general"

def fetch_job_titles_and_locations(engine):
    with engine.connect() as conn:
        titles = [r[0] for r in conn.execute(text("SELECT DISTINCT title FROM jobs")).fetchall()]
        locations = [r[0] for r in conn.execute(
            text("SELECT DISTINCT location FROM jobs WHERE location IS NOT NULL")
        ).fetchall()]
    return titles, locations

def generate_profile_text(title, experience_years, skills, domain):
    return (
        f"{title} professional with {experience_years:.1f} years of experience in {domain.replace('_', ' ')}. "
        f"Core skills: {', '.join(skills)}. "
        f"Seeking roles that build on this {domain.replace('_', ' ')} background."
    )

def generate_users(engine):
    titles, locations = fetch_job_titles_and_locations(engine)
    print(f"Pulled {len(titles)} distinct titles and {len(locations)} distinct locations from jobs table.")

    users = []
    for user_id in range(1, NUM_USERS + 1):
        title = random.choice(titles)
        location = random.choice(locations)
        experience_years = round(random.uniform(0, 20), 1)
        domain = infer_domain(title)
        skill_pool = DOMAIN_SKILLS.get(domain, DOMAIN_SKILLS["general"])
        # Mix in 1-2 general soft skills for realism, rest domain-specific
        skills = random.sample(skill_pool, k=min(len(skill_pool), random.randint(3, 6)))
        general_extra = random.sample(DOMAIN_SKILLS["general"], k=1)
        skills = list(set(skills + general_extra))

        profile_text = generate_profile_text(title, experience_years, skills, domain)

        users.append({
            "user_id": user_id,
            "profile_text": profile_text,
            "location": location,
            "current_title": title,
            "total_experience_years": experience_years,
            "skills": skills,
        })
    return pd.DataFrame(users)

def load_users():
    engine = get_engine()
    df = generate_users(engine)

    with engine.begin() as conn:
        for _, row in df.iterrows():
            conn.execute(
                text("""
                    INSERT INTO users (user_id, profile_text, location, current_title, total_experience_years, skills)
                    VALUES (:user_id, :profile_text, :location, :current_title, :total_experience_years, :skills)
                    ON CONFLICT (user_id) DO NOTHING
                """),
                {
                    "user_id": row["user_id"],
                    "profile_text": row["profile_text"],
                    "location": row["location"],
                    "current_title": row["current_title"],
                    "total_experience_years": row["total_experience_years"],
                    "skills": row["skills"],
                }
            )
    print(f"Inserted {len(df)} users into the database.")

if __name__ == "__main__":
    load_users()