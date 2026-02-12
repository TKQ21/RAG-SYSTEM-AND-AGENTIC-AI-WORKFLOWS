# RAG SYSTEM AND AGENTIC AI WORKFLOWS 



## DATA SCIENCE HELPER



### HOW TO KNOW ITS WORKING OR NOT?







##### Q1. I have a dataset with 100k rows and 200 features.

##### Target variable is highly imbalanced (95% class 0).

##### Which model would you recommend and why?

##### Also suggest evaluation metrics.





###### For a dataset of this scale (100k rows, 200 features) with a significant class imbalance (95/5), the choice of model and evaluation strategy is critical. A standard accuracy metric will fail here, as a "dumb" model predicting 0 for everything would achieve 95% accuracy while being entirely useless.

###### 

###### \### 1. Recommended Model: Gradient Boosted Decision Trees (GBDT)

###### Specifically, LightGBM or XGBoost.

###### 

###### Why?

###### \* Handling Imbalance: These libraries have built-in parameters (is\_unbalance=True or scale\_pos\_weight) that automatically adjust the loss function to penalize misclassifications of the minority class more heavily.

###### \* Feature Complexity: With 200 features, there are likely non-linear interactions. Tree-based ensembles capture these better than linear models.

###### \* Efficiency: LightGBM is exceptionally fast on 100k rows and handles memory efficiently.

###### \* Robustness: They are less sensitive to outliers and do not require feature scaling (unlike SVMs or Neural Networks).

###### 

###### ---

###### 

###### \### 2. Suggested Evaluation Metrics

###### Stop using Accuracy. Instead, use:

###### 

###### 1\. Precision-Recall AUC (PR-AUC): Better than ROC-AUC for imbalanced data because it focuses on the performance of the minority class (Positive class) without being inflated by the large number of True Negatives.

###### 2\. F1-Score (or F-Beta): The harmonic mean of Precision and Recall. Use F-Beta if you care more about catching all positives (high recall) or being sure about the ones you catch (high precision).

###### 3\. Matthews Correlation Coefficient (MCC): Considered one of the best single-number metrics for imbalance as it accounts for all four quadrants of the confusion matrix.

###### 

###### ---

###### 

###### \### 3. Implementation Example (LightGBM)

###### 

###### This script demonstrates a robust pipeline including automated weight balancing and PR-AUC evaluation.

###### 

###### import numpy as np

###### import pandas as pd

###### import lightgbm as lgb

###### from sklearn.model\_selection import train\_test\_split

###### from sklearn.metrics import (

###### &nbsp;   classification\_report, 

###### &nbsp;   average\_precision\_score, 

###### &nbsp;   precision\_recall\_curve, 

###### &nbsp;   confusion\_matrix

###### )

###### 

###### \# 1. Setup Synthetic Data (matching your description)

###### n\_samples = 100000

###### n\_features = 200

###### X = np.random.randn(n\_samples, n\_features)

###### \# Generate imbalanced target (95% zeros)

###### y = np.random.binomial(1, 0.05, n\_samples)

###### 

###### \# Split into train/test

###### X\_train, X\_test, y\_train, y\_test = train\_test\_split(

###### &nbsp;   X, y, test\_size=0.2, stratify=y, random\_state=42

###### )

###### 

###### \# 2. Configure LightGBM 

###### \# scale\_pos\_weight = count(negative) / count(positive)

###### \# In your case: 95 / 5 = 19

###### clf = lgb.LGBMClassifier(

###### &nbsp;   n\_estimators=1000,

###### &nbsp;   learning\_rate=0.05,

###### &nbsp;   max\_depth=7,

###### &nbsp;   num\_leaves=31,

###### &nbsp;   scale\_pos\_weight=19,  # Crucial for imbalance

###### &nbsp;   importance\_type='gain',

###### &nbsp;   n\_jobs=-1

###### )

###### 

###### \# 3. Training with Early Stopping to prevent overfitting

###### clf.fit(

###### &nbsp;   X\_train, y\_train,

###### &nbsp;   eval\_set=\[(X\_test, y\_test)],

###### &nbsp;   eval\_metric='auc\_mu', # Good for imbalanced scenarios

###### &nbsp;   callbacks=\[lgb.early\_stopping(stopping\_rounds=50)]

###### )

###### 

###### \# 4. Evaluation

###### y\_pred\_proba = clf.predict\_proba(X\_test)\[:, 1]

###### y\_pred = (y\_pred\_proba > 0.5).astype(int)

###### 

###### \# Calculate PR-AUC

###### pr\_auc = average\_precision\_score(y\_test, y\_pred\_proba)

###### 

###### print(f"\\nPR-AUC Score: {pr\_auc:.4f}")

###### print("\\nConfusion Matrix:")

###### print(confusion\_matrix(y\_test, y\_pred))

###### print("\\nClassification Report:")

###### print(classification\_report(y\_test, y\_pred))

###### 

###### \# Performance Consideration: 

###### \# If 100k rows is too slow, use `is\_unbalance=True` instead of `scale\_pos\_weight`.

###### \# `is\_unbalance` is better for high-variance weights.

###### 

###### 

###### ---

###### 

###### \### 4. Advanced Strategies to Improve Results

###### 

###### If the GBDT model above isn't sufficient, consider these steps:

###### 

###### \#### A. Resampling (SMOTE vs. Downsampling)

###### \* Downsampling (Recommended for your size): 100k is large enough that you can afford to discard some of the majority class. Try reducing the 95k "zeros" to 20k-30k. This often speeds up training and improves the decision boundary.

###### \* SMOTE (Synthetic Minority Over-sampling Technique): Creates synthetic samples for the minority class. Use this with caution as it can introduce noise if features are overlapping.

###### 

###### \#### B. Threshold Tuning

###### By default, models use 0.5 as the decision threshold. For imbalanced data, you should almost always tune this.

###### \* Iterate through thresholds (0.1 to 0.9).

###### \* Pick the threshold that maximizes the F1-score or meets your specific business constraint (e.g., "I must catch 80% of fraud cases").

###### 

###### \#### C. Calibration

###### Imbalanced models often produce biased probabilities when using scale\_pos\_weight. If you need the output to be a "real" probability (e.g., for expected value calculations), use Platt Scaling or Isotonic Regression after training.

###### 

###### \### Summary Recommendation

###### Start with LightGBM using scale\_pos\_weight=19. Use PR-AUC as your primary tuning metric, and perform Stratified K-Fold cross-validation to ensure your 5% minority class is represented in every fold.

###### 





##### Q2. My RandomForest model has high training accuracy but low test accuracy.

##### Explain the possible reasons and how to fix it.

##### 







###### When a Random Forest (RF) performs significantly better on training data than on testing data, it is overfitting.

###### 

###### While Random Forests are designed to reduce variance via bagging, they can still overfit if the individual trees are allowed to become too deep and complex, essentially "memorizing" individual data points and noise rather than learning general patterns.

###### 

###### Here are the primary reasons and the corresponding fixes:

###### 

###### \### 1. The Trees are Too Deep

###### By default, scikit-learn’s RandomForestClassifier grows trees until all leaves are pure. In an imbalanced dataset (like yours), a tree might grow 50 levels deep just to isolate a single noisy outlier.

###### \* The Fix: Limit the complexity of individual trees.

###### \* max\_depth: Set a limit (e.g., 10–20).

###### \* min\_samples\_leaf: Increase this (e.g., 20–50). This forces the model to only make a split if the resulting leaves contain a minimum number of samples, smoothing the decision boundary.

###### 

###### \### 2. High Feature Cardinality (The 200 Features)

###### With 200 features, there is a high risk of "Spurious Correlations." If you have ID-like features or high-cardinality categorical variables (like Zip Codes), the RF will use them to perfectly split the training data, but they won't generalize.

###### \* The Fix:

###### \* max\_features: Reduce this to 'sqrt' or even lower (e.g., 0.1 or 0.2). This forces each tree to look at a smaller subset of features, increasing the diversity of the trees and reducing the chance that any one noise-heavy feature dominates.

###### 

###### \### 3. Data Leakage

###### This is a common "silent killer." If a feature in your training set contains information about the target that wouldn't be available at prediction time (e.g., a "Customer ID" that is sequential with the fraud event), the model will have "perfect" accuracy in training/val but fail in production.

###### \* The Fix: Check the feature\_importances\_. If one feature is significantly more important than all others, investigate it for leakage.

###### 

###### \### 4. Class Imbalance Impact

###### In your specific case (95/5 split), a standard RF tries to maximize global accuracy. It might overfit the minority class samples to try and "catch" them all, creating tiny "islands" of predictions in the feature space.

###### \* The Fix: Use class\_weight="balanced" or class\_weight="balanced\_subsample".

###### 

###### ---

###### 

###### \### Implementation: The "Robust" Random Forest

###### Here is how to refactor your Random Forest to combat overfitting:

###### 

###### import numpy as np

###### from sklearn.ensemble import RandomForestClassifier

###### from sklearn.model\_selection import RandomizedSearchCV

###### from sklearn.metrics import classification\_report

###### 

###### \# 1. Define a more constrained model

###### rf = RandomForestClassifier(

###### &nbsp;   n\_estimators=200,          # More trees generally reduce variance

###### &nbsp;   max\_depth=12,              # Prevents trees from memorizing noise

###### &nbsp;   min\_samples\_leaf=20,       # Ensures nodes are statistically significant

###### &nbsp;   max\_features='sqrt',       # Limits feature-based overfitting

###### &nbsp;   class\_weight='balanced',   # Handles your 95/5 imbalance

###### &nbsp;   n\_jobs=-1,

###### &nbsp;   random\_state=42

###### )

###### 

###### \# 2. Use a Parameter Grid for Tuning (if still overfitting)

###### param\_dist = {

###### &nbsp;   'max\_depth': \[10, 15, 20, None],

###### &nbsp;   'min\_samples\_split': \[2, 10, 20],

###### &nbsp;   'min\_samples\_leaf': \[1, 5, 20],

###### &nbsp;   'max\_samples': \[0.7, 0.8, 0.9] # Training on a subset of rows (Subsampling)

###### }

###### 

###### \# Example of using max\_samples to add more randomness

###### \# (Bagging with replacement on only 80% of data)

###### search = RandomizedSearchCV(

###### &nbsp;   rf, param\_distributions=param\_dist, 

###### &nbsp;   n\_iter=10, cv=3, scoring='f1', n\_jobs=-1

###### )

###### 

###### \# search.fit(X\_train, y\_train)

###### 

###### 

###### \### Steps to Debug and Fix (Process)

###### 

###### 1\. Plot Validation Curves:

###### Plot training vs. test scores across different max\_depth values. Where the lines start to diverge is where overfitting begins.

###### 2\. Feature Selection:

###### Run a baseline model, look at model.feature\_importances\_, and remove the bottom 50–100 features that contribute zero importance. Fewer features = less noise = less overfitting.

###### 3\. Check for "Identical" Rows:

###### With 100k rows, ensure you don't have duplicated rows in Training and Testing sets (common in oversampling scenarios like SMOTE).

###### 4\. Decrease `n\_estimators`? NO.

###### Contrary to intuition, adding more trees to a Random Forest never causes overfitting; it actually helps the model converge to a more stable error rate. The overfitting comes from the depth of those trees.

###### 

###### Key takeaway: If you are at 99% train accuracy and 80% test accuracy, the model is too "flexible." Tighten max\_depth and increase min\_samples\_leaf until the two scores meet in the middle.

